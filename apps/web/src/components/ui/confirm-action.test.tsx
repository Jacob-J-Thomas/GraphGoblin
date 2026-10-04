import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmAction } from './confirm-action.js';

describe('ConfirmAction', () => {
  it('names the item, announces consequences, focuses Keep, and returns focus on cancellation', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn();
    render(
      <ConfirmAction
        name="nightly"
        consequences={<p>All versions are removed.</p>}
        onConfirm={confirm}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Delete nightly' });
    expect(trigger).toHaveClass('h-8', 'bg-danger-subtle', 'cursor-pointer');
    await user.click(trigger);
    const dialog = screen.getByRole('alertdialog', { name: 'Delete “nightly”?' });
    expect(dialog).toHaveAccessibleDescription('All versions are removed. This cannot be undone.');
    expect(screen.getByRole('button', { name: 'Keep' })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Confirm delete nightly' })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: 'Keep' })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'ArrowDown' });
    await user.click(screen.getByRole('button', { name: 'Keep' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(confirm).not.toHaveBeenCalled();
    await user.click(trigger);
    fireEvent(screen.getByRole('alertdialog'), new Event('cancel', { cancelable: true }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('locks confirmation, Keep and Escape while pending, and closes after success', async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    const confirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <ConfirmAction
        action="revoke"
        name="CI"
        accessibleName="Revoke CI"
        consequences="Clients get 401."
        onConfirm={confirm}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Revoke CI' });
    await user.click(trigger);
    const button = screen.getByRole('button', { name: 'Confirm revoke CI' });
    await user.click(button);
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Revoking…');
    expect(screen.getByRole('button', { name: 'Keep' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Please wait');
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Tab' });
    expect(screen.getByRole('alertdialog')).toHaveFocus();
    fireEvent(screen.getByRole('alertdialog'), new Event('cancel', { cancelable: true }));
    expect(screen.getByRole('alertdialog')).toHaveAttribute('aria-busy', 'true');
    expect(confirm).toHaveBeenCalledTimes(1);
    await act(() => Promise.resolve(finish()));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('keeps errors announced until retried or dismissed, including a second failure', async () => {
    const user = userEvent.setup();
    const confirm = vi
      .fn()
      .mockRejectedValueOnce(new Error('Already removed (404)'))
      .mockRejectedValueOnce(new Error('Still unavailable'))
      .mockResolvedValue(undefined);
    render(<ConfirmAction name="token" consequences="Scripts fail." onConfirm={confirm} />);
    await user.click(screen.getByRole('button', { name: 'Delete token' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete token' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Already removed (404)');
    expect(screen.getByRole('alertdialog')).toHaveAttribute('aria-busy', 'false');
    await user.click(screen.getByRole('button', { name: 'Confirm delete token' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Still unavailable');
    await user.click(screen.getByRole('button', { name: 'Keep' }));
    await user.click(screen.getByRole('button', { name: 'Delete token' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm delete token' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it.each([true, false])(
    'returns focus to a surviving heading after row removal (section: %s)',
    async (section) => {
      function Rows() {
        const [exists, setExists] = useState(true);
        const action = exists ? (
          <ConfirmAction
            name="row"
            consequences="Row is removed."
            onConfirm={() => {
              setExists(false);
              return Promise.resolve();
            }}
          />
        ) : null;
        return (
          <main>
            <h1>Loops</h1>
            {section ? (
              <section>
                <h2>Secrets</h2>
                {action}
              </section>
            ) : (
              action
            )}
          </main>
        );
      }
      render(<Rows />);
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Delete row' }));
      await user.click(screen.getByRole('button', { name: 'Confirm delete row' }));
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: section ? 'Secrets' : 'Loops' })).toHaveFocus(),
      );
    },
  );
});
