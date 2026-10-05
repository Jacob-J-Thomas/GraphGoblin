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
        title="Loop settings"
        expanded={expanded}
        onExpandedChange={setExpanded}
        rail={<span>3 variables</span>}
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
    const panel = screen.getByRole('complementary', { name: 'Loop settings' });
    expect(panel).toHaveAttribute('id', 'panel');
    expect(screen.getByText('Panel body')).toBeInTheDocument();
    expect(screen.queryByText('3 variables')).toBeNull();
    const hide = screen.getByRole('button', { name: 'Hide loop settings' });
    expect(hide).toHaveAttribute('aria-expanded', 'true');
    expect(hide).toHaveAttribute('aria-controls', 'panel');

    // Its own Hide button is gone once collapsed, so focus moves to Show.
    await user.click(hide);
    expect(screen.queryByText('Panel body')).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Loop settings' })).toHaveAttribute(
      'id',
      'panel',
    );
    expect(screen.getByText('3 variables')).toBeInTheDocument();
    const show = screen.getByRole('button', { name: 'Show loop settings' });
    expect(show).toHaveAttribute('aria-expanded', 'false');
    expect(show).toHaveAttribute('aria-controls', 'panel');
    expect(show).toHaveFocus();

    // Expanding moves focus to the panel's heading.
    await user.click(show);
    expect(screen.getByRole('heading', { name: 'Loop settings' })).toHaveFocus();
  });

  it('leaves focus on an outside toggle that collapses it, and focuses the heading when it opens', async () => {
    const user = userEvent.setup();
    render(<Harness initial={false} />);
    const toggle = screen.getByRole('button', { name: 'Toggle' });
    await user.click(toggle);
    expect(screen.getByRole('heading', { name: 'Loop settings' })).toHaveFocus();
    await user.click(toggle);
    expect(toggle).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Show loop settings' })).not.toHaveFocus();
  });

  it('keeps only its Show button on the rail when it has no summary', () => {
    render(
      <SidePanel
        id="bare"
        title="Loop settings"
        expanded={false}
        onExpandedChange={() => undefined}
      >
        <p>Panel body</p>
      </SidePanel>,
    );
    const rail = screen.getByRole('complementary', { name: 'Loop settings' });
    expect(rail.querySelectorAll('button')).toHaveLength(1);
    expect(rail.firstElementChild).toBe(screen.getByRole('button', { name: 'Show loop settings' }));
    expect(rail.children[1]).toHaveAttribute('data-testid', 'bare-rail-content');
    expect(rail.children[1]?.childElementCount).toBe(0);
    expect(
      screen.getByRole('button', { name: 'Show loop settings' }).querySelector('svg'),
    ).toHaveAttribute('data-icon', 'panel');
  });

  it.each([
    ['right', 'lg', 'max-lg:right-0'],
    ['left', 'md', 'max-md:left-0'],
  ] as const)(
    'floats a %s panel over the content below %s while expanded, never as a rail (#41)',
    (side, overlayBelow, edge) => {
      const { rerender } = render(
        <SidePanel
          id="floating"
          title="Loop settings"
          side={side}
          expanded
          overlayBelow={overlayBelow}
          onExpandedChange={() => undefined}
        >
          <p>Panel body</p>
        </SidePanel>,
      );
      const panel = screen.getByRole('complementary', { name: 'Loop settings' });
      expect(panel).toHaveClass(
        `max-${overlayBelow}:absolute`,
        edge,
        `max-${overlayBelow}:shadow-3`,
      );
      // Its head is a band with the heading colour (tinted in light, #11).
      expect(screen.getByRole('heading', { name: 'Loop settings' })).toHaveClass('text-heading');
      expect(screen.getByRole('heading', { name: 'Loop settings' }).parentElement).toHaveClass(
        'bg-surface-head',
      );
      rerender(
        <SidePanel
          id="floating"
          title="Loop settings"
          side={side}
          expanded={false}
          overlayBelow={overlayBelow}
          onExpandedChange={() => undefined}
        >
          <p>Panel body</p>
        </SidePanel>,
      );
      expect(screen.getByRole('complementary', { name: 'Loop settings' })).not.toHaveClass(
        `max-${overlayBelow}:absolute`,
      );
    },
  );

  it('stays in its own column at every width without overlayBelow', () => {
    render(
      <SidePanel id="docked" title="Loop settings" expanded onExpandedChange={() => undefined}>
        <p>Panel body</p>
      </SidePanel>,
    );
    expect(screen.getByRole('complementary', { name: 'Loop settings' }).className).not.toMatch(
      /absolute/,
    );
  });

  it('keeps a left panel rail ordered and moves Hide to Show on collapse', async () => {
    const user = userEvent.setup();
    function LeftHarness() {
      const [expanded, setExpanded] = useState(false);
      return (
        <SidePanel
          id="left-panel"
          title="Palette"
          side="left"
          expanded={expanded}
          onExpandedChange={setExpanded}
        >
          <p>Palette body</p>
        </SidePanel>
      );
    }
    render(<LeftHarness />);

    const rail = screen.getByRole('complementary', { name: 'Palette' });
    expect(rail).toHaveAttribute('data-side', 'left');
    const show = screen.getByRole('button', { name: 'Show palette' });
    expect(show).toHaveAttribute('aria-expanded', 'false');
    expect(show).toHaveAttribute('aria-controls', 'left-panel');
    expect(show).toHaveClass('pointer-coarse:min-h-11', 'pointer-coarse:min-w-11');
    expect(show.querySelector('svg')).toHaveAttribute('data-icon', 'panel');
    expect(show.querySelector('svg')).toHaveStyle({ transform: 'scaleX(-1)' });
    await user.click(show);
    const panel = screen.getByRole('complementary', { name: 'Palette' });
    expect(panel).toHaveAttribute('data-side', 'left');
    const heading = screen.getByRole('heading', { name: 'Palette' });
    expect(heading).toHaveFocus();
    const hide = screen.getByRole('button', { name: 'Hide palette' });
    expect(hide.parentElement?.children[0]).toBe(hide);
    expect(hide.parentElement?.children[1]).toBe(heading);
    expect(hide).toHaveAttribute('aria-expanded', 'true');
    expect(hide).toHaveAttribute('aria-controls', 'left-panel');
    await user.click(hide);
    expect(screen.queryByRole('heading', { name: 'Palette' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Show palette' })).toHaveFocus();
  });
});
