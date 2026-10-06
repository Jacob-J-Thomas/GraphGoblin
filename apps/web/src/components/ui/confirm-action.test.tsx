import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmAction } from './confirm-action.js';

describe('ConfirmAction', () => {
  it.each(['same tick', 'after the refresh frame'] as const)(
    'focuses the section heading when action settlement and row removal occur %s',
    async (timing) => {
      const frames: FrameRequestCallback[] = [];
      vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
      const flushFrames = () => frames.splice(0).forEach((callback) => callback(0));
      let finish!: () => void;
      const action = new Promise<void>((resolve) => {
        finish = resolve;
      });
      let remove!: () => void;
      function Rows() {
        const [exists, setExists] = useState(true);
        remove = () => setExists(false);
        return (
          <section aria-labelledby="race-heading">
            <h2 id="race-heading">Models</h2>
            {exists ? (
              <ConfirmAction
                name="race row"
                consequences="Gone."
                onConfirm={() => action}
                onConfirmed={() => Promise.resolve()}
              />
            ) : null}
          </section>
        );
      }
      render(<Rows />);
      const user = userEvent.setup();
      const trigger = screen.getByRole('button', { name: 'Delete race row' });
      await user.click(trigger);
      await user.click(screen.getByRole('button', { name: 'Confirm delete race row' }));
      await act(async () => {
        finish();
        if (timing === 'same tick') remove();
        await action;
      });
      act(flushFrames);
      if (timing === 'after the refresh frame') {
        // The refresh and every scheduled frame finish while React still shows the opener.
        expect(trigger).toHaveFocus();
        await act(() => Promise.resolve(remove()));
        act(flushFrames);
      }
      expect(trigger).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Models' })).toHaveFocus();
    },
  );

  it('prevents busy Escape at keydown before the browser can close or restore background focus', async () => {
    let finish!: () => void;
    render(
      <ConfirmAction
        name="keydown"
        consequences="Gone."
        onConfirm={() =>
          new Promise<void>((resolve) => {
            finish = resolve;
          })
        }
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Delete keydown' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete keydown' }));
    const modal = screen.getByRole('alertdialog');
    try {
      const escape = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      fireEvent(modal, escape);
      expect(escape.defaultPrevented).toBe(true);
      expect(modal).toHaveFocus();
    } finally {
      await act(() => Promise.resolve(finish()));
    }
  });

  it('ignores a queued stale native close after an idle confirmation has reopened', async () => {
    render(<ConfirmAction name="stale" consequences="Gone." onConfirm={() => Promise.resolve()} />);
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: 'Delete stale' });
    await user.click(trigger);
    const modal = screen.getByRole<HTMLDialogElement>('alertdialog');
    modal.open = false;
    fireEvent(modal, new Event('close'));
    await waitFor(() => expect(trigger).toHaveFocus());
    await user.click(trigger);
    await act(
      () =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            fireEvent(modal, new Event('close'));
            resolve();
          }, 0),
        ),
    );
    expect(screen.getByRole('alertdialog')).toBe(modal);
    expect(screen.getByRole('button', { name: 'Keep' })).toHaveFocus();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    fireEvent(modal, escape);
    expect(escape.defaultPrevented).toBe(false);
    fireEvent(modal, new Event('cancel', { cancelable: true }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('review: reopens a queued native close while busy', async () => {
    let finish!: () => void;
    const show = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    render(
      <ConfirmAction
        name="busy"
        consequences="Versions are removed."
        onConfirm={() =>
          new Promise<void>((resolve) => {
            finish = resolve;
          })
        }
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Delete busy' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete busy' }));
    const modal = screen.getByRole<HTMLDialogElement>('alertdialog');
    try {
      await act(
        () =>
          new Promise<void>((resolve) =>
            queueMicrotask(() => {
              modal.open = false;
              fireEvent(modal, new Event('close'));
              resolve();
            }),
          ),
      );
      expect(show).toHaveBeenCalledTimes(2);
      expect(modal.open).toBe(true);
      expect(modal).toHaveFocus();
    } finally {
      await act(() => Promise.resolve(finish()));
    }
  });

  it('review: follows an idle native close so the trigger can open again', async () => {
    render(<ConfirmAction name="idle" consequences="Gone." onConfirm={() => Promise.resolve()} />);
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: 'Delete idle' });
    await user.click(trigger);
    const modal = screen.getByRole<HTMLDialogElement>('alertdialog');
    modal.open = false;
    fireEvent(modal, new Event('close'));
    await user.click(trigger);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('consumes a queued programmatic close after reopening without swallowing the next native close', async () => {
    vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (
      this: HTMLDialogElement,
    ) {
      this.open = false;
    });
    render(<ConfirmAction name="race" consequences="Gone." onConfirm={() => Promise.resolve()} />);
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: 'Delete race' });
    await user.click(trigger);
    const modal = screen.getByRole<HTMLDialogElement>('alertdialog');
    await user.click(screen.getByRole('button', { name: 'Keep' }));
    await user.click(trigger);
    fireEvent(modal, new Event('close'));
    expect(modal.open).toBe(true);
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(screen.getByRole('button', { name: 'Keep' })).toHaveFocus();
    modal.open = false;
    fireEvent(modal, new Event('close'));
    await user.click(trigger);
    expect(modal.open).toBe(true);
  });

  it('preserves an existing tabindex on the explicit fallback target', async () => {
    function Rows() {
      const [exists, setExists] = useState(true);
      return (
        <>
          <h2 id="fallback" tabIndex={0}>
            Models
          </h2>
          {exists ? (
            <ConfirmAction
              name="model"
              returnFocusTo="fallback"
              consequences="Gone."
              onConfirm={() => {
                setExists(false);
                return Promise.resolve();
              }}
            />
          ) : null}
        </>
      );
    }
    render(<Rows />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Delete model' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete model' }));
    const heading = screen.getByRole('heading');
    await waitFor(() => expect(heading).toHaveFocus());
    expect(heading).toHaveAttribute('tabindex', '0');
  });

  it('review: derives the revoke name and announces a dialog with a ban icon', () => {
    render(
      <ConfirmAction
        action="revoke"
        name="CI"
        consequences="Clients get 401."
        onConfirm={() => Promise.resolve()}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Revoke CI' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger.querySelector('[data-icon="cancelled"]')).not.toBeNull();
  });

  it('review: pending content cannot select status text through a disabled button', async () => {
    let finish!: () => void;
    render(
      <ConfirmAction
        name="pending"
        consequences="Gone."
        onConfirm={() =>
          new Promise<void>((resolve) => {
            finish = resolve;
          })
        }
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Delete pending' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete pending' }));
    try {
      expect(screen.getByRole('alertdialog')).toHaveClass('select-none');
    } finally {
      await act(() => Promise.resolve(finish()));
    }
  });

  it('review: an explicit focus target wins over the first section heading without tabindex residue', async () => {
    function Rows() {
      const [exists, setExists] = useState(true);
      const options = { returnFocusTo: 'chosen-heading' };
      return (
        <section aria-labelledby="first-heading">
          <h2 id="first-heading">First</h2>
          <h2 id="chosen-heading">Chosen</h2>
          {exists ? (
            <ConfirmAction
              {...options}
              name="row"
              consequences="Gone."
              onConfirm={() => {
                setExists(false);
                return Promise.resolve();
              }}
            />
          ) : null}
        </section>
      );
    }
    render(<Rows />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Delete row' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete row' }));
    const heading = screen.getByRole('heading', { name: 'Chosen' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(heading).toHaveAttribute('tabindex', '-1');
    heading.blur();
    expect(heading).not.toHaveAttribute('tabindex');
  });
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
            {...(!section ? { returnFocusTo: 'loops-heading' } : {})}
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
            <h1 id="loops-heading">Loops</h1>
            {section ? (
              <section aria-labelledby="secrets-heading">
                <h2 id="secrets-heading">Secrets</h2>
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
      screen.getByRole('heading', { name: section ? 'Secrets' : 'Loops' }).blur();
      expect(
        screen.getByRole('heading', { name: section ? 'Secrets' : 'Loops' }),
      ).not.toHaveAttribute('tabindex');
    },
  );
});
