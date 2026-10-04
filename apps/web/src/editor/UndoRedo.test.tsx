import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newLoopDefinition } from './model.js';
import { useEditorStore } from './store.js';
import { UndoRedo } from './UndoRedo.js';

const store = () => useEditorStore.getState();

describe('UndoRedo', () => {
  beforeEach(() => store().load('L1', newLoopDefinition('a')));
  afterEach(() => store().reset());

  it('names each button by the step it changes, and keeps it focusable when there is none', async () => {
    const user = userEvent.setup();
    render(<UndoRedo apple={false} />);
    const undo = screen.getByRole('button', { name: 'Undo' });
    const redo = screen.getByRole('button', { name: 'Redo' });
    for (const button of [undo, redo]) {
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).not.toBeDisabled();
    }
    expect(undo).toHaveAttribute('title', 'Undo');
    expect(undo).toHaveAttribute('aria-keyshortcuts', 'Control+Z');
    expect(redo).toHaveAttribute('aria-keyshortcuts', 'Control+Shift+Z Control+Y');
    // Pressing a button with nothing to do does nothing.
    await user.click(undo);
    await user.click(redo);
    expect(store()).toMatchObject({ revision: 0, historyEpoch: 0 });

    act(() => store().moveNode('start', { x: 40, y: 80 }));
    expect(undo).toHaveAccessibleName('Undo move start');
    expect(undo).toHaveAttribute('title', 'Undo move start');
    expect(undo).not.toHaveAttribute('aria-disabled');
    // Keyboard operable: Tab to it and press Enter, then Space on Redo.
    act(() => redo.blur());
    await user.tab();
    expect(undo).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(store().definition!.nodes[0]!.ui).toEqual({ x: 0, y: 80 });
    expect(undo).toHaveAccessibleName('Undo');
    expect(redo).toHaveAccessibleName('Redo move start');
    await user.tab();
    expect(redo).toHaveFocus();
    await user.keyboard(' ');
    expect(store().definition!.nodes[0]!.ui).toEqual({ x: 40, y: 80 });
    expect(undo).toHaveAccessibleName('Undo move start');
    expect(redo).toHaveAttribute('aria-disabled', 'true');

    // The name is the button's text, not a label: looking up a field by label never finds it.
    act(() => store().updateMeta({ description: 'about' }));
    expect(undo).toHaveAccessibleName('Undo edit loop description');
    expect(screen.queryAllByLabelText(/description/i)).toEqual([]);
  });

  it('shows the Apple shortcuts on Apple platforms', () => {
    render(<UndoRedo apple />);
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Meta+Z',
    );
    expect(screen.getByRole('button', { name: 'Redo' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Meta+Shift+Z',
    );
  });

  it('reads the platform by default', () => {
    render(<UndoRedo />);
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Control+Z',
    );
  });
});
