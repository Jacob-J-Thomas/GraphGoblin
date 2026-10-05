import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';
import {
  Disclosure,
  DISCLOSURE_PANEL_SELECTOR,
  Fieldset,
  Legend,
  revealDisclosures,
} from './index.js';

const panelOf = (toggle: HTMLElement) =>
  document.getElementById(toggle.getAttribute('aria-controls')!)!;

describe('Disclosure', () => {
  it('is a button that shows and hides its panel, named with its summary', async () => {
    const user = userEvent.setup();
    render(
      <Disclosure label="Advanced" summary={<span>2 set</span>}>
        <input aria-label="Inside" />
      </Disclosure>,
    );
    const toggle = screen.getByRole('button', { name: 'Advanced 2 set' });
    expect(toggle).toHaveAttribute('type', 'button');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const panel = panelOf(toggle);
    expect(panel).toHaveAttribute('hidden');
    expect(panel.matches(DISCLOSURE_PANEL_SELECTOR)).toBe(true);
    // The panel stays mounted while hidden, so its fields keep their state.
    expect(screen.getByLabelText('Inside')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Inside' })).toBeNull();
    // The visible focus ring every control shares, and a chevron that turns with the state.
    expect(toggle).toHaveClass('focus-visible:outline-2', 'focus-visible:outline-focus');
    expect(toggle.querySelector('svg[data-icon="chevron"]')).toHaveClass(
      '-rotate-90',
      'group-aria-expanded/disclosure:rotate-0',
    );

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(panel).not.toHaveAttribute('hidden');
    expect(screen.getByRole('textbox', { name: 'Inside' })).toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('toggles from the keyboard: Tab to it, then Enter or Space', async () => {
    const user = userEvent.setup();
    render(
      <Disclosure label="Advanced">
        <p>Inside</p>
      </Disclosure>,
    );
    await user.tab();
    const toggle = screen.getByRole('button', { name: 'Advanced' });
    expect(toggle).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('starts open on request, and draws a list item header with its actions', () => {
    render(
      <Disclosure
        variant="row"
        defaultOpen
        label="Operations 1"
        actions={<button type="button">Remove operations 1</button>}
      >
        <p>Fields</p>
      </Disclosure>,
    );
    const toggle = screen.getByRole('button', { name: 'Operations 1' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveClass('flex-1');
    // The actions sit after the toggle in the header, before the panel.
    const remove = screen.getByRole('button', { name: 'Remove operations 1' });
    expect(toggle.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('Fields')).toBeVisible();
  });

  it('opens at once from outside, innermost and outermost, so a field inside can take focus', async () => {
    const user = userEvent.setup();
    render(
      <StrictMode>
        <Disclosure label="Advanced">
          <Disclosure variant="row" label="Operations 1">
            <input aria-label="Path" />
          </Disclosure>
        </Disclosure>
        <input aria-label="Outside" />
      </StrictMode>,
    );
    const outer = screen.getByRole('button', { name: 'Advanced' });
    const path = screen.getByLabelText('Path');
    act(() => {
      revealDisclosures(path);
      // Shown in the same task: it can take focus now.
      path.focus();
    });
    expect(path).toHaveFocus();
    expect(outer).toHaveAttribute('aria-expanded', 'true');
    const inner = screen.getByRole('button', { name: 'Operations 1' });
    expect(inner).toHaveAttribute('aria-expanded', 'true');
    expect(panelOf(inner)).not.toHaveAttribute('hidden');
    // React's state followed: the toggle closes it again.
    await user.click(outer);
    expect(outer).toHaveAttribute('aria-expanded', 'false');
    expect(panelOf(outer)).toHaveAttribute('hidden');
    // Elements outside any disclosure, and open ones, are left alone.
    revealDisclosures(screen.getByLabelText('Outside'));
    await user.click(outer);
    revealDisclosures(path);
    expect(outer).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('Fieldset sections', () => {
  it('heads a borderless section with a quiet legend, ruled off from the one before', () => {
    render(
      <div>
        <Fieldset variant="section">
          <Legend variant="section">Context</Legend>
        </Fieldset>
        <Fieldset variant="section">
          <Legend variant="section">Limits</Legend>
        </Fieldset>
      </div>,
    );
    const context = screen.getByRole('group', { name: 'Context' });
    expect(context).toHaveClass('border-0', 'not-first:border-t');
    expect(context).not.toHaveClass('rounded-md');
    expect(screen.getByText('Limits')).toHaveClass('uppercase', 'text-muted');
  });
});
