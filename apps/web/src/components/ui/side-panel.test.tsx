import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button, readPanelState, SidePanel, useSidePanelState, writePanelState } from './index.js';

const KEY = 'test-panel';

describe('side panel state', () => {
  it('uses the default until a state is stored, and ignores values it does not know', () => {
    expect(readPanelState(KEY)).toBeUndefined();
    const fallback = vi.fn(() => true);
    const { result } = renderHook(() => useSidePanelState(KEY, fallback));
    expect(result.current[0]).toBe(true);
    expect(fallback).toHaveBeenCalledTimes(1);

    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    expect(localStorage.getItem(KEY)).toBe('collapsed');
    expect(renderHook(() => useSidePanelState(KEY, () => true)).result.current[0]).toBe(false);

    localStorage.setItem(KEY, 'sideways');
    expect(renderHook(() => useSidePanelState(KEY, () => false)).result.current[0]).toBe(false);
    localStorage.setItem(KEY, 'expanded');
    expect(renderHook(() => useSidePanelState(KEY, () => false)).result.current[0]).toBe(true);
  });

  it('falls back to the default and keeps working when storage throws', () => {
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readPanelState(KEY)).toBeUndefined();
    expect(writePanelState(KEY, 'expanded')).toBe(false);
    const { result } = renderHook(() => useSidePanelState(KEY, () => false));
    expect(result.current[0]).toBe(false);
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    read.mockRestore();
    write.mockRestore();
    expect(writePanelState(KEY, 'collapsed')).toBe(true);
    expect(readPanelState(KEY)).toBe('collapsed');
  });
});

/** A panel with a toggle outside it, as the editor toolbar has. */
function Harness({ initial }: { initial: boolean }) {
  const [expanded, setExpanded] = useState(initial);
  return (
    <>
      <Button aria-expanded={expanded} aria-controls="panel" onClick={() => setExpanded(!expanded)}>
        Toggle
      </Button>
      <SidePanel
        id="panel"
        title="Loop"
        expanded={expanded}
        onExpandedChange={setExpanded}
        rail={<span>2 errors</span>}
      >
        <p>Panel body</p>
      </SidePanel>
    </>
  );
}

describe('SidePanel', () => {
  it('collapses to a rail with a Show button and its summary, and expands again', async () => {
    const user = userEvent.setup();
    render(<Harness initial={true} />);
    const panel = screen.getByRole('complementary', { name: 'Loop' });
    expect(panel).toHaveAttribute('id', 'panel');
    expect(screen.getByText('Panel body')).toBeInTheDocument();
    expect(screen.queryByText('2 errors')).toBeNull();
    const hide = screen.getByRole('button', { name: 'Hide loop' });
    expect(hide).toHaveAttribute('aria-expanded', 'true');
    expect(hide).toHaveAttribute('aria-controls', 'panel');

    // Its own Hide button is gone once collapsed, so focus moves to Show.
    await user.click(hide);
    expect(screen.queryByText('Panel body')).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Loop' })).toHaveAttribute('id', 'panel');
    expect(screen.getByText('2 errors')).toBeInTheDocument();
    const show = screen.getByRole('button', { name: 'Show loop' });
    expect(show).toHaveAttribute('aria-expanded', 'false');
    expect(show).toHaveAttribute('aria-controls', 'panel');
    expect(show).toHaveFocus();

    // Expanding moves focus to the panel's heading.
    await user.click(show);
    expect(screen.getByRole('heading', { name: 'Loop' })).toHaveFocus();
  });

  it('leaves focus on an outside toggle that collapses it, and focuses the heading when it opens', async () => {
    const user = userEvent.setup();
    render(<Harness initial={false} />);
    const toggle = screen.getByRole('button', { name: 'Toggle' });
    await user.click(toggle);
    expect(screen.getByRole('heading', { name: 'Loop' })).toHaveFocus();
    await user.click(toggle);
    expect(toggle).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Show loop' })).not.toHaveFocus();
  });
});
