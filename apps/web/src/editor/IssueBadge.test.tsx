import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IssueBadge } from './IssueBadge.js';
import { IssueList, refocusAfterDiscard, worstSeverity } from './IssuePopover.js';
import { fieldErrorIssues, newLoopDefinition, type EditorIssue } from './model.js';
import { useEditorStore } from './store.js';

const error: EditorIssue = {
  code: 'SCHEMA',
  severity: 'error',
  message: 'Too small: expected string to have >=1 characters',
  nodeId: 'prep',
  path: 'config.prompt.template',
};
const warning: EditorIssue = {
  code: 'CRITERION_ABOVE_CEILING',
  severity: 'warning',
  message: 'criterion is above the loop ceiling',
  nodeId: 'prep',
};

function badge(issues: EditorIssue[], onChoose = vi.fn()) {
  return render(<IssueBadge nodeId="prep" issues={issues} onChoose={onChoose} />);
}

describe('IssueBadge', () => {
  beforeEach(() => useEditorStore.getState().load('L1', newLoopDefinition('badges')));

  it('is a button named by the count and node, showing only the icon for one issue', () => {
    badge([error]);
    const button = screen.getByRole('button', { name: '1 issue on prep' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    expect(button.getAttribute('aria-controls')).toBe(
      screen.getByRole('dialog', { hidden: true }).id,
    );
    expect(button).toHaveTextContent(/^$/);
    expect(button.querySelector('svg')).toHaveAttribute('data-icon', 'failed');
    expect(button).toHaveAttribute('data-severity', 'error');
    // xyflow ignores presses, wheel, and keys from it; the hit target is at least 24 px.
    expect(button).toHaveClass('nodrag', 'nopan', 'nowheel', 'nokey', 'h-6', 'min-w-6');
    expect(button).toHaveClass(
      'bg-status-bad-bg',
      'text-status-bad-fg',
      'border-status-bad-border',
    );
  });

  it('shows the count from two issues on, and the worst severity by icon shape and tone', () => {
    const { rerender } = badge([warning, { ...warning, message: 'another' }]);
    let button = screen.getByRole('button', { name: '2 issues on prep' });
    expect(button).toHaveTextContent('2');
    expect(button.querySelector('svg')).toHaveAttribute('data-icon', 'alert');
    expect(button).toHaveAttribute('data-severity', 'warning');
    expect(button).toHaveClass('bg-status-warn-bg', 'text-status-warn-fg');

    // Any error makes it an error badge.
    rerender(<IssueBadge nodeId="prep" issues={[warning, error, warning]} onChoose={vi.fn()} />);
    button = screen.getByRole('button', { name: '3 issues on prep' });
    expect(button).toHaveTextContent('3');
    expect(button.querySelector('svg')).toHaveAttribute('data-icon', 'failed');
    expect(button).toHaveAttribute('data-severity', 'error');
    expect(worstSeverity([warning])).toBe('warning');
    expect(worstSeverity([warning, error])).toBe('error');
  });

  it('opens its popover on a click that goes no further, and lists each issue', async () => {
    const user = userEvent.setup();
    const outer = vi.fn();
    render(
      <div onClick={outer}>
        <IssueBadge nodeId="prep" issues={[error, warning]} onChoose={vi.fn()} />
      </div>,
    );
    await user.click(screen.getByRole('button', { name: '2 issues on prep' }));
    expect(outer).not.toHaveBeenCalled();
    const popover = screen.getByRole('dialog', { name: 'Issues on prep' });
    expect(popover).toHaveClass('nodrag', 'nopan', 'nowheel', 'nokey', 'bg-surface-overlay');
    expect(popover).toHaveTextContent('1 error, 1 warning on prep');
    const rows = within(popover).getAllByRole('button');
    expect(rows).toHaveLength(2);
    // Severity by word and icon, the code, the message, and the field path.
    expect(rows[0]).toHaveTextContent('Error');
    expect(rows[0]!.querySelector('[data-icon="failed"]')).not.toBeNull();
    expect(rows[0]).toHaveTextContent('SCHEMA');
    expect(rows[0]).toHaveTextContent(error.message);
    expect(within(rows[0]!).getByText('config.prompt.template').tagName).toBe('CODE');
    expect(rows[1]).toHaveTextContent('Warning');
    expect(rows[1]!.querySelector('[data-icon="alert"]')).not.toBeNull();
    expect(rows[1]!.querySelectorAll('code')).toHaveLength(0);
  });

  it('chooses an issue: the popover closes and the issue goes to onChoose', async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    badge([error, warning], onChoose);
    await user.click(screen.getByRole('button', { name: '2 issues on prep' }));
    await user.click(screen.getByRole('button', { name: /Error SCHEMA/ }));
    expect(onChoose).toHaveBeenCalledWith(error);
    expect(screen.queryByRole('dialog', { name: 'Issues on prep' })).toBeNull();
  });

  it('discards unparsed text from the popover, keeping focus in sight', async () => {
    const user = userEvent.setup();
    const store = useEditorStore.getState;
    store().setFieldError('node:prep', 'inputSchema', { message: 'Invalid JSON', text: '{' });
    store().setFieldError('node:prep', 'output', { message: 'Invalid JSON', text: '[' });
    function Live() {
      const fieldErrors = useEditorStore((s) => s.fieldErrors);
      const issues = fieldErrorIssues(fieldErrors);
      return (
        <>
          <button type="button">Fallback</button>
          {issues.length > 0 ? (
            <IssueBadge
              nodeId="prep"
              issues={issues}
              onChoose={vi.fn()}
              fallbackFocus={() => screen.getByRole('button', { name: 'Fallback' })}
            />
          ) : null}
        </>
      );
    }
    render(<Live />);
    await user.click(screen.getByRole('button', { name: '2 issues on prep' }));
    const discard = screen.getByRole('button', { name: 'Discard unparsed text at inputSchema' });
    expect(discard).toHaveTextContent('Discard text');
    await user.click(discard);
    // One issue left: the popover closes with focus back on its badge.
    expect(store().fieldErrors).toEqual({
      'node:prep': { output: { message: 'Invalid JSON', text: '[' } },
    });
    const left = screen.getByRole('button', { name: '1 issue on prep' });
    await waitFor(() => expect(left).toHaveFocus());
    expect(left).toHaveAttribute('aria-expanded', 'false');

    // The last one: the badge goes, and focus goes to the fallback rather than the page.
    await user.click(left);
    await user.click(screen.getByRole('button', { name: 'Discard unparsed text at output' }));
    expect(store().fieldErrors).toEqual({});
    expect(screen.queryByRole('button', { name: /on prep/ })).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Fallback' })).toHaveFocus());
  });
});

describe('IssueList', () => {
  it('shows rows that only inform without onChoose, naming each issue’s node or edge', () => {
    render(
      <IssueList
        subject
        issues={[
          { code: 'NO_EXIT', severity: 'error', message: 'needs an exit' },
          { code: 'EDGE_TO_MISSING', severity: 'error', message: 'no target', edgeId: 'e7' },
          { code: 'CRON_INVALID', severity: 'error', message: 'bad cron', nodeId: 'gone' },
        ]}
      />,
    );
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('needs an exit');
    expect(items[0]!.querySelectorAll('code')).toHaveLength(0);
    expect(within(items[1]!).getByText('edge e7').tagName).toBe('CODE');
    expect(within(items[2]!).getByText('node gone').tagName).toBe('CODE');
  });

  it('refocuses the trigger after a discard, or the fallback when focus was lost', () => {
    vi.useFakeTimers();
    try {
      const close = vi.fn();
      const target = document.body.appendChild(document.createElement('button'));
      refocusAfterDiscard(close, () => target);
      expect(close).toHaveBeenCalledWith({ returnFocus: true });
      act(() => {
        vi.runAllTimers();
      });
      expect(target).toHaveFocus();
      // Focus already somewhere: left alone. No fallback: nothing happens.
      const other = document.body.appendChild(document.createElement('button'));
      other.focus();
      refocusAfterDiscard(close, () => target);
      act(() => {
        vi.runAllTimers();
      });
      expect(other).toHaveFocus();
      other.blur();
      refocusAfterDiscard(close);
      act(() => {
        vi.runAllTimers();
      });
      expect(document.body).toHaveFocus();
      target.remove();
      other.remove();
    } finally {
      vi.useRealTimers();
    }
  });
});
