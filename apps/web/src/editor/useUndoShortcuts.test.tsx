import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newLoopDefinition } from './model.js';
import { useEditorStore } from './store.js';
import {
  historyShortcut,
  historyShortcuts,
  isApplePlatform,
  isEditableTarget,
  useUndoShortcuts,
} from './useUndoShortcuts.js';

const store = () => useEditorStore.getState();

const press = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);

describe('platform and keys', () => {
  it('recognises Apple platforms from userAgentData or navigator.platform', () => {
    expect(isApplePlatform({ platform: 'MacIntel' })).toBe(true);
    expect(isApplePlatform({ platform: 'iPhone' })).toBe(true);
    expect(isApplePlatform({ platform: '', userAgentData: { platform: 'macOS' } })).toBe(true);
    expect(isApplePlatform({ platform: 'Win32', userAgentData: { platform: 'Windows' } })).toBe(
      false,
    );
    expect(isApplePlatform({ platform: 'Linux x86_64', userAgentData: { platform: '' } })).toBe(
      false,
    );
    // jsdom's navigator is not Apple's.
    expect(isApplePlatform()).toBe(false);
    expect(historyShortcuts(false)).toEqual({
      undo: 'Control+Z',
      redo: 'Control+Shift+Z Control+Y',
    });
    expect(historyShortcuts(true)).toEqual({ undo: 'Meta+Z', redo: 'Meta+Shift+Z' });
  });

  it('maps Ctrl+Z, Ctrl+Shift+Z, and Ctrl+Y on Windows and Linux', () => {
    expect(historyShortcut(press({ key: 'z', ctrlKey: true }), false)).toBe('undo');
    expect(historyShortcut(press({ key: 'Z', ctrlKey: true, shiftKey: true }), false)).toBe('redo');
    expect(historyShortcut(press({ key: 'y', ctrlKey: true }), false)).toBe('redo');
    expect(historyShortcut(press({ key: 'Y', ctrlKey: true, shiftKey: true }), false)).toBe(
      undefined,
    );
    expect(historyShortcut(press({ key: 'z' }), false)).toBeUndefined();
    expect(historyShortcut(press({ key: 'z', metaKey: true }), false)).toBeUndefined();
    expect(historyShortcut(press({ key: 'z', ctrlKey: true, metaKey: true }), false)).toBe(
      undefined,
    );
    // AltGr arrives as Ctrl+Alt and types characters on some layouts.
    expect(historyShortcut(press({ key: 'z', ctrlKey: true, altKey: true }), false)).toBe(
      undefined,
    );
    expect(historyShortcut(press({ key: 'x', ctrlKey: true }), false)).toBeUndefined();
    expect(historyShortcut(press({ key: 'z', ctrlKey: true, isComposing: true }), false)).toBe(
      undefined,
    );
    // Layouts: the character decides (AZERTY's z sits on KeyW); a non-Latin layout falls back to
    // the key's place.
    expect(historyShortcut(press({ key: 'z', code: 'KeyW', ctrlKey: true }), false)).toBe('undo');
    expect(historyShortcut(press({ key: 'w', code: 'KeyZ', ctrlKey: true }), false)).toBe(
      undefined,
    );
    expect(historyShortcut(press({ key: 'я', code: 'KeyZ', ctrlKey: true }), false)).toBe('undo');
    expect(
      historyShortcut(press({ key: 'Control', code: 'ControlLeft', ctrlKey: true }), false),
    ).toBeUndefined();
  });

  it('maps Cmd+Z and Cmd+Shift+Z on Apple platforms', () => {
    expect(historyShortcut(press({ key: 'z', metaKey: true }), true)).toBe('undo');
    expect(historyShortcut(press({ key: 'z', metaKey: true, shiftKey: true }), true)).toBe('redo');
    expect(historyShortcut(press({ key: 'y', metaKey: true }), true)).toBeUndefined();
    expect(historyShortcut(press({ key: 'z', ctrlKey: true }), true)).toBeUndefined();
  });

  const TEXT_TYPES = [
    'text',
    'search',
    'url',
    'email',
    'password',
    'number',
    'tel',
    'date',
    'datetime-local',
    'month',
    'week',
    'time',
  ];
  const OTHER_TYPES = ['checkbox', 'radio', 'range', 'color', 'file', 'button', 'submit', 'reset'];

  it('leaves text editors to their own undo, and nothing else', () => {
    const { container } = render(
      <div>
        <input aria-label="untyped" />
        {[...TEXT_TYPES, ...OTHER_TYPES].map((type) => (
          <input key={type} type={type} aria-label={`${type} input`} />
        ))}
        <input type="checkbox" role="switch" aria-label="switch input" />
        <button type="button" role="switch" aria-checked="false">
          Switch button
        </button>
        <textarea aria-label="area" />
        <select aria-label="pick" />
        <div contentEditable suppressContentEditableWarning data-testid="editable">
          <span data-testid="inside">x</span>
        </div>
        <div contentEditable={false} data-testid="not-editable" />
        <div className="cm-editor">
          <div data-testid="code" />
        </div>
        <button type="button">Press</button>
      </div>,
    );
    // Text-entry inputs, textareas, content-editable elements, and CodeMirror keep the keys.
    for (const label of ['untyped', 'area', ...TEXT_TYPES.map((type) => `${type} input`)]) {
      expect(isEditableTarget(screen.getByLabelText(label)), label).toBe(true);
    }
    expect(isEditableTarget(screen.getByTestId('inside'))).toBe(true);
    expect(isEditableTarget(screen.getByTestId('code'))).toBe(true);
    // Choices, switches, selects, and buttons have no text to undo: the editor's undo applies.
    for (const label of ['pick', 'switch input', ...OTHER_TYPES.map((type) => `${type} input`)]) {
      expect(isEditableTarget(screen.getByLabelText(label)), label).toBe(false);
    }
    expect(isEditableTarget(screen.getByRole('switch', { name: 'Switch button' }))).toBe(false);
    expect(isEditableTarget(screen.getByTestId('not-editable'))).toBe(false);
    expect(isEditableTarget(screen.getByRole('button', { name: 'Press' }))).toBe(false);
    expect(isEditableTarget(container)).toBe(false);
    expect(isEditableTarget(document)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

/** A panel whose form remounts on every undo and redo, as the editor's forms do. */
function Harness({ apple = false, children }: { apple?: boolean; children?: ReactNode }) {
  useUndoShortcuts(apple);
  const epoch = useEditorStore((s) => s.historyEpoch);
  // The loop's name stands for a value the form shows: "a" or "b".
  const name = useEditorStore((s) => s.definition?.name);
  return (
    <>
      <section aria-labelledby="panel-heading">
        <h2 id="panel-heading" tabIndex={-1}>
          Panel
        </h2>
        <div key={epoch}>
          <div data-field="items">
            <button type="button">Add item</button>
            <input aria-label="Item" />
          </div>
          <fieldset data-field="flags">
            <input type="checkbox" aria-label="Flag one" />
            <input type="checkbox" aria-label="Flag two" />
            <input type="checkbox" role="switch" aria-label="Flag switch" />
          </fieldset>
          <fieldset data-field="choice">
            <input type="radio" name="choice" aria-label="Choice a" defaultChecked={name === 'a'} />
            <input type="radio" name="choice" aria-label="Choice b" defaultChecked={name === 'b'} />
          </fieldset>
          <div data-field="pick">
            <select aria-label="Pick" defaultValue={name}>
              <option value="a">a</option>
              <option value="b">b</option>
            </select>
          </div>
          <button type="button">Loose button</button>
          {name === 'b' ? <button type="button">Last in panel</button> : null}
        </div>
      </section>
      <div key={`outside-${epoch}`}>
        <button type="button">Unlabelled area</button>
      </div>
      <div data-editor-canvas="" tabIndex={-1} data-testid="canvas" />
      {children}
      <div key={`end-${epoch}`}>
        {name === 'b' ? <button type="button">Last on page</button> : null}
      </div>
    </>
  );
}

describe('useUndoShortcuts', () => {
  beforeEach(() => {
    store().load('L1', newLoopDefinition('a'));
    store().updateMeta({ name: 'b' });
  });
  afterEach(() => store().reset());

  const keydown = (target: Element, init: KeyboardEventInit) =>
    fireEvent.keyDown(target, { bubbles: true, cancelable: true, ...init });

  it('undoes and redoes with focus anywhere but a form control, and takes the key', () => {
    const view = render(<Harness />);
    expect(keydown(document.body, { key: 'z', ctrlKey: true })).toBe(false);
    expect(store().definition!.name).toBe('a');
    keydown(document.body, { key: 'y', ctrlKey: true });
    expect(store().definition!.name).toBe('b');
    keydown(screen.getByRole('button', { name: 'Loose button' }), { key: 'z', ctrlKey: true });
    expect(store().definition!.name).toBe('a');
    keydown(document.body, { key: 'Z', ctrlKey: true, shiftKey: true });
    expect(store().definition!.name).toBe('b');

    // Inside a text field the browser's own undo keeps the key.
    expect(keydown(screen.getByLabelText('Item'), { key: 'z', ctrlKey: true })).toBe(true);
    expect(store().definition!.name).toBe('b');
    // A key another handler already took is left alone; other keys pass through.
    const taken = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, cancelable: true });
    taken.preventDefault();
    document.body.dispatchEvent(taken);
    expect(store().definition!.name).toBe('b');
    expect(keydown(document.body, { key: 'x', ctrlKey: true })).toBe(true);

    // Gone with the editor.
    view.unmount();
    keydown(document.body, { key: 'z', ctrlKey: true });
    expect(store().definition!.name).toBe('b');
  });

  it('uses Cmd on Apple platforms', () => {
    render(<Harness apple />);
    keydown(document.body, { key: 'z', ctrlKey: true });
    expect(store().definition!.name).toBe('b');
    keydown(document.body, { key: 'z', metaKey: true });
    expect(store().definition!.name).toBe('a');
    keydown(document.body, { key: 'z', metaKey: true, shiftKey: true });
    expect(store().definition!.name).toBe('b');
  });

  it('keeps focus in the field whose form remounted, else on the panel heading or the canvas', () => {
    render(<Harness />);
    const undoKey = () =>
      keydown(document.activeElement ?? document.body, { key: 'z', ctrlKey: true });

    // A button inside a field: focus moves to the same control of the new form.
    act(() => screen.getByRole('button', { name: 'Add item' }).focus());
    undoKey();
    expect(store().definition!.name).toBe('a');
    expect(screen.getByRole('button', { name: 'Add item' })).toHaveFocus();

    // Outside any field: the control in the same place of what stayed (the panel, the page).
    act(() => store().redo());
    act(() => screen.getByRole('button', { name: 'Loose button' }).focus());
    undoKey();
    expect(screen.getByRole('button', { name: 'Loose button' })).toHaveFocus();
    act(() => store().redo());
    act(() => screen.getByRole('button', { name: 'Unlabelled area' }).focus());
    undoKey();
    expect(screen.getByRole('button', { name: 'Unlabelled area' })).toHaveFocus();

    // A control the undo removed, with nothing in its place: the panel's heading.
    act(() => store().redo());
    act(() => screen.getByRole('button', { name: 'Last in panel' }).focus());
    undoKey();
    expect(screen.queryByRole('button', { name: 'Last in panel' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Panel' })).toHaveFocus();

    // Nowhere named: the canvas.
    act(() => store().redo());
    act(() => screen.getByRole('button', { name: 'Last on page' }).focus());
    undoKey();
    expect(screen.queryByRole('button', { name: 'Last on page' })).toBeNull();
    expect(screen.getByTestId('canvas')).toHaveFocus();

    // Focus on something that stays: it stays.
    act(() => store().redo());
    undoKey();
    expect(screen.getByTestId('canvas')).toHaveFocus();
    expect(store().definition!.name).toBe('a');
  });

  it('undoes from a checkbox, a switch, a radio, or a select, keeping focus in place', () => {
    render(<Harness />);
    const undoFrom = (label: string) => {
      const control = screen.getByLabelText(label);
      act(() => control.focus());
      return keydown(control, { key: 'z', ctrlKey: true });
    };
    const redoFrom = (label: string) =>
      keydown(screen.getByLabelText(label), { key: 'y', ctrlKey: true });

    // The second checkbox of a group: focus goes to the second checkbox of the new form.
    expect(undoFrom('Flag two')).toBe(false);
    expect(store().definition!.name).toBe('a');
    expect(screen.getByLabelText('Flag two')).toHaveFocus();
    redoFrom('Flag two');
    expect(store().definition!.name).toBe('b');
    undoFrom('Flag switch');
    expect(store().definition!.name).toBe('a');
    expect(screen.getByLabelText('Flag switch')).toHaveFocus();
    redoFrom('Flag switch');

    // A radio group whose choice the undo changed: the newly checked radio takes focus.
    expect(screen.getByLabelText('Choice b')).toBeChecked();
    undoFrom('Choice b');
    expect(store().definition!.name).toBe('a');
    expect(screen.getByLabelText('Choice a')).toBeChecked();
    expect(screen.getByLabelText('Choice a')).toHaveFocus();
    redoFrom('Choice a');
    expect(screen.getByLabelText('Choice b')).toHaveFocus();

    // A select: the select of the new form, showing the restored value.
    undoFrom('Pick');
    expect(store().definition!.name).toBe('a');
    expect(screen.getByLabelText('Pick')).toHaveFocus();
    expect(screen.getByLabelText('Pick')).toHaveValue('a');
  });

  it('falls back to the field’s first control when the same place is gone', () => {
    /** A field whose second button exists only while the loop is named "b". */
    function Shrinking() {
      const epoch = useEditorStore((s) => s.historyEpoch);
      const name = useEditorStore((s) => s.definition?.name);
      return (
        <section key={epoch} data-testid="shrinking">
          <div data-field="rows">
            <button type="button">Row one</button>
            {name === 'b' ? <button type="button">Row two</button> : null}
          </div>
        </section>
      );
    }
    render(
      <Harness>
        <Shrinking />
      </Harness>,
    );
    act(() => screen.getByRole('button', { name: 'Row two' }).focus());
    keydown(screen.getByRole('button', { name: 'Row two' }), { key: 'z', ctrlKey: true });
    expect(screen.queryByRole('button', { name: 'Row two' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Row one' })).toHaveFocus();
  });

  it('leaves focus where a closing component put it', () => {
    /** Moves focus to the canvas as it unmounts, as the node editor does when its node goes. */
    function ReturnsFocus() {
      useEffect(() => () => document.querySelector<HTMLElement>('[data-editor-canvas]')?.focus());
      return <button type="button">Inside</button>;
    }
    function Closing() {
      const name = useEditorStore((s) => s.definition?.name);
      return name === 'b' ? <ReturnsFocus /> : null;
    }
    render(
      <Harness>
        <Closing />
      </Harness>,
    );
    act(() => screen.getByRole('button', { name: 'Inside' }).focus());
    keydown(screen.getByRole('button', { name: 'Inside' }), { key: 'z', ctrlKey: true });
    expect(screen.queryByRole('button', { name: 'Inside' })).toBeNull();
    expect(screen.getByTestId('canvas')).toHaveFocus();
  });
});
