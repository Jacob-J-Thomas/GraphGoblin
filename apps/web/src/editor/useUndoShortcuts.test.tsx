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

  it('leaves form controls and text editors to their own undo', () => {
    const { container } = render(
      <div>
        <input aria-label="text" />
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
    for (const label of ['text', 'area', 'pick']) {
      expect(isEditableTarget(screen.getByLabelText(label))).toBe(true);
    }
    expect(isEditableTarget(screen.getByTestId('inside'))).toBe(true);
    expect(isEditableTarget(screen.getByTestId('code'))).toBe(true);
    expect(isEditableTarget(screen.getByTestId('not-editable'))).toBe(false);
    expect(isEditableTarget(screen.getByRole('button'))).toBe(false);
    expect(isEditableTarget(container)).toBe(false);
    expect(isEditableTarget(document)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

/** A panel whose form remounts on every undo and redo, as the editor's forms do. */
function Harness({ apple = false, children }: { apple?: boolean; children?: ReactNode }) {
  useUndoShortcuts(apple);
  const epoch = useEditorStore((s) => s.historyEpoch);
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
          <button type="button">Loose button</button>
        </div>
      </section>
      <div key={`outside-${epoch}`}>
        <button type="button">Unlabelled area</button>
      </div>
      <div data-editor-canvas="" tabIndex={-1} data-testid="canvas" />
      {children}
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

    // A button inside a field: focus moves to the same field of the new form.
    act(() => screen.getByRole('button', { name: 'Add item' }).focus());
    undoKey();
    expect(store().definition!.name).toBe('a');
    expect(screen.getByLabelText('Item')).toHaveFocus();

    // Outside any field: the heading of the panel it was in.
    store().redo();
    act(() => screen.getByRole('button', { name: 'Loose button' }).focus());
    undoKey();
    expect(screen.getByRole('heading', { name: 'Panel' })).toHaveFocus();

    // Nowhere named: the canvas.
    store().redo();
    act(() => screen.getByRole('button', { name: 'Unlabelled area' }).focus());
    undoKey();
    expect(screen.getByTestId('canvas')).toHaveFocus();

    // Focus on something that stays: it stays.
    store().redo();
    undoKey();
    expect(screen.getByTestId('canvas')).toHaveFocus();
    expect(store().definition!.name).toBe('a');
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
