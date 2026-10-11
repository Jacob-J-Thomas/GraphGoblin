import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Tabs, revealTabs } from './tabs.js';

function Harness() {
  const [selected, setSelected] = useState('main');
  return (
    <Tabs
      label="Configuration"
      selected={selected}
      onSelect={setSelected}
      items={[
        { id: 'main', label: 'Settings', content: <input aria-label="Prompt" /> },
        { id: 'context', label: 'Context', content: <input aria-label="Vars" /> },
      ]}
    />
  );
}

describe('Tabs', () => {
  it('keeps the main panel identity when a contextual evaluator gains or loses tabs', () => {
    const items = [
      { id: 'main', label: 'Settings', content: <input aria-label="Prompt" /> },
      { id: 'context', label: 'Context', content: <input aria-label="Vars" /> },
    ];
    const { rerender } = render(
      <Tabs
        label="Configuration"
        selected="main"
        onSelect={() => undefined}
        items={items.slice(0, 1)}
      />,
    );
    const prompt = screen.getByRole('textbox', { name: 'Prompt' });
    expect(screen.queryByRole('tablist')).toBeNull();
    rerender(
      <Tabs label="Configuration" selected="main" onSelect={() => undefined} items={items} />,
    );
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toBe(prompt);
    rerender(
      <Tabs
        label="Configuration"
        selected="main"
        onSelect={() => undefined}
        items={items.slice(0, 1)}
      />,
    );
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toBe(prompt);
  });
  it('links each tab and mounted panel with one tab stop', () => {
    render(<Harness />);
    expect(screen.getByRole('tablist')).toHaveAccessibleName('Configuration');
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1]);
    for (const tab of tabs) {
      const panel = document.getElementById(tab.getAttribute('aria-controls')!)!;
      expect(panel).toHaveAttribute('role', 'tabpanel');
      expect(panel).toHaveAttribute('aria-labelledby', tab.id);
    }
    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
    expect(document.querySelector('input[aria-label="Vars"]')).toBeInTheDocument();
  });

  it('automatically activates arrows, wraps, and supports Home and End', async () => {
    render(<Harness />);
    const user = userEvent.setup();
    const main = screen.getByRole('tab', { name: 'Settings' });
    const context = screen.getByRole('tab', { name: 'Context' });
    main.focus();
    for (const [key, selected] of [
      ['ArrowRight', context],
      ['ArrowRight', main],
      ['ArrowLeft', context],
      ['Home', main],
      ['End', context],
    ] as const) {
      await user.keyboard(`{${key}}`);
      expect(selected).toHaveFocus();
      expect(selected).toHaveAttribute('aria-selected', 'true');
      expect(selected).toHaveAttribute('tabindex', '0');
    }
    await user.keyboard('{Tab}');
    expect(screen.getByRole('textbox', { name: 'Vars' })).toHaveFocus();
  });

  it('keeps edited values and DOM identity through pointer switches', async () => {
    render(<Harness />);
    const user = userEvent.setup();
    const prompt = screen.getByRole('textbox', { name: 'Prompt' });
    await user.type(prompt, 'held');
    await user.click(screen.getByRole('tab', { name: 'Context' }));
    expect(prompt).not.toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Settings' }));
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toBe(prompt);
    expect(prompt).toHaveValue('held');
  });

  it('reveals synchronously without moving focus and ignores unrelated keys/elements', () => {
    render(<Harness />);
    const vars = document.querySelector<HTMLInputElement>('input[aria-label="Vars"]')!;
    act(() => {
      revealTabs(vars);
      vars.focus();
    });
    expect(vars).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Context' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Context' }), { key: 'ArrowDown' });
    act(() => revealTabs(vars));
    act(() => revealTabs(document.body));
    act(() => {
      screen
        .getByRole('tablist')
        .parentElement!.dispatchEvent(new Event('graphgoblin:reveal-tab', { bubbles: true }));
    });
    expect(screen.getByRole('tab', { name: 'Context' })).toHaveAttribute('aria-selected', 'true');
  });
});
