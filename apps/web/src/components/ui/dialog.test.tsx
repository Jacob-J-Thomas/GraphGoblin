import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { dialogClose, nextTask } from '../../__fixtures__/dialog.js';
import { Button, Dialog, Input, type DialogCloseReason } from './index.js';

/** An owner that opens the dialog from a button and closes it unless told to refuse. */
function Owner({
  refuse = [],
  onClose = () => undefined,
  closeOnBackdrop,
  returnFocus,
}: {
  refuse?: DialogCloseReason[];
  onClose?: (reason: DialogCloseReason) => void;
  closeOnBackdrop?: boolean;
  returnFocus?: () => HTMLElement | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open</Button>
      <Button>Elsewhere</Button>
      <Dialog
        open={open}
        onClose={(reason) => {
          onClose(reason);
          if (!refuse.includes(reason)) setOpen(false);
        }}
        title="Edit trigger start"
        description="Changes save as you type."
        icon={<span data-testid="icon" />}
        footer={<Button onClick={() => setOpen(false)}>Done</Button>}
        {...(closeOnBackdrop !== undefined ? { closeOnBackdrop } : {})}
        {...(returnFocus ? { returnFocus } : {})}
      >
        <Input aria-label="Label" />
        <p>Body</p>
      </Dialog>
    </>
  );
}

const dialog = () => screen.getByRole<HTMLDialogElement>('dialog', { hidden: true });

describe('Dialog', () => {
  it('opens as a named, described modal with focus on its heading, and returns focus on close', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Owner onClose={onClose} />);
    expect(dialog().open).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Open' }));

    const open = screen.getByRole('dialog', { name: 'Edit trigger start' });
    expect(open).toHaveAttribute('open');
    expect(open).toHaveAttribute('aria-modal', 'true');
    expect(open).toHaveAccessibleDescription('Changes save as you type.');
    expect(screen.getByRole('heading', { name: 'Edit trigger start' })).toHaveFocus();
    expect(screen.getByTestId('icon')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledWith('button');
    expect(dialog().open).toBe(false);
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();

    // The footer's own action closes it the same way.
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(dialog().open).toBe(false);
  });

  it('asks to close on Esc, and the owner may refuse', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Owner onClose={onClose} refuse={['escape']} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByLabelText('Label'));
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledWith('escape');
    expect(dialog().open).toBe(true);
  });

  it('follows the browser when it closes the dialog without asking', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Owner onClose={onClose} refuse={['escape']} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    // A cancel the page may not refuse (a repeated Esc): nothing is asked; the close follows.
    act(() => {
      dialog().dispatchEvent(new Event('cancel', { cancelable: false }));
    });
    expect(onClose).not.toHaveBeenCalled();
    // Browsers deliver the close event as a queued task, after close() returns.
    await act(async () => {
      dialog().close();
      await nextTask();
    });
    expect(onClose).toHaveBeenCalledWith('dismissed');
    expect(dialog().open).toBe(false);

    // Delivered at once (some engines, the sync stand-in), the same.
    dialogClose.delivery = 'sync';
    onClose.mockClear();
    await user.click(screen.getByRole('button', { name: 'Open' }));
    act(() => dialog().close());
    expect(onClose).toHaveBeenCalledWith('dismissed');
  });

  it('stays open under Strict Mode, whose replayed effect closes and reopens it (close is a task)', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    // Mounted open, as the node editor is: Strict Mode replays the mount effect at once.
    function MountedOpen() {
      const [shown, setShown] = useState(false);
      return (
        <>
          <Button onClick={() => setShown(true)}>Open</Button>
          {shown ? (
            <Dialog
              open
              onClose={(reason) => {
                onClose(reason);
                setShown(false);
              }}
              title="Edit trigger start"
            >
              <Input aria-label="Label" />
            </Dialog>
          ) : null}
        </>
      );
    }
    render(
      <StrictMode>
        <MountedOpen />
      </StrictMode>,
    );
    await user.click(screen.getByRole('button', { name: 'Open' }));
    // The close event from the replayed effect's cleanup arrives after the dialog reopened.
    await act(nextTask);
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog().open).toBe(true);
    expect(screen.getByRole('heading', { name: 'Edit trigger start' })).toHaveFocus();
    // It still closes when asked, and a later dismissal by the browser is still reported.
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledWith('escape');
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await act(nextTask);
    await act(async () => {
      dialog().close();
      await nextTask();
    });
    expect(onClose).toHaveBeenLastCalledWith('dismissed');
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
  });

  it('ignores a close event that arrives while the dialog is open again', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Owner onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    act(() => {
      dialog().dispatchEvent(new Event('close'));
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog().open).toBe(true);
  });

  it('closes on a click on the backdrop only when the press started there too', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Owner onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    // jsdom lays nothing out, so the dialog's box is empty and any point but the origin is outside.
    // A press inside (a text selection dragged out) never closes it.
    fireEvent.mouseDown(screen.getByLabelText('Label'), { clientX: 5, clientY: 5 });
    fireEvent.click(dialog(), { clientX: 5, clientY: 5 });
    // A press and click on the dialog's own box (its border, inside) never closes it.
    fireEvent.mouseDown(dialog(), { clientX: 0, clientY: 0 });
    fireEvent.click(dialog(), { clientX: 0, clientY: 0 });
    // A click on the content never does.
    fireEvent.mouseDown(screen.getByText('Body'), { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByText('Body'), { clientX: 5, clientY: 5 });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(dialog(), { clientX: 5, clientY: 5 });
    fireEvent.click(dialog(), { clientX: 5, clientY: 5 });
    expect(onClose).toHaveBeenCalledWith('backdrop');
    expect(dialog().open).toBe(false);
  });

  it('ignores the rest of the double-click that opened it, and only that', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Owner onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    // The second click of the double-click lands on the backdrop: it does not close the dialog.
    fireEvent.mouseDown(dialog(), { detail: 2, clientX: 5, clientY: 5 });
    fireEvent.click(dialog(), { detail: 2, clientX: 5, clientY: 5 });
    // Nor does a further click of the same sequence press a control that opened under it.
    const done = screen.getByRole('button', { name: 'Done' });
    fireEvent.mouseDown(done, { detail: 3 });
    fireEvent.click(done, { detail: 3 });
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog().open).toBe(true);

    // A new click sequence on the backdrop closes it as usual.
    fireEvent.mouseDown(dialog(), { detail: 1, clientX: 5, clientY: 5 });
    fireEvent.click(dialog(), { detail: 1, clientX: 5, clientY: 5 });
    expect(onClose).toHaveBeenCalledWith('backdrop');
    expect(dialog().open).toBe(false);

    // After a first press inside, a deliberate double-click there is a double-click as usual.
    await user.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.mouseDown(screen.getByLabelText('Label'), { detail: 1 });
    fireEvent.click(screen.getByLabelText('Label'), { detail: 1 });
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Done' }), { detail: 2 });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }), { detail: 2 });
    expect(dialog().open).toBe(false);
  });

  it('ignores the backdrop when closing there could lose input', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Owner onClose={onClose} closeOnBackdrop={false} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.mouseDown(dialog(), { clientX: 5, clientY: 5 });
    fireEvent.click(dialog(), { clientX: 5, clientY: 5 });
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog().open).toBe(true);
  });

  it('keeps Tab and Shift+Tab inside the dialog, in visual order', async () => {
    const user = userEvent.setup();
    render(<Owner />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    // From the heading: Close, the field, then the footer's Done; then round to Close.
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText('Label')).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Done' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Done' })).toHaveFocus();
    // Shift+Tab from the heading goes to the last control too.
    act(() => screen.getByRole('heading', { name: 'Edit trigger start' }).focus());
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Done' })).toHaveFocus();
    // Other keys pass through untouched.
    await user.keyboard('a');
    expect(screen.getByRole('button', { name: 'Done' })).toHaveFocus();
  });

  it('returns focus where the owner says, and only to an element still on the page', async () => {
    const user = userEvent.setup();
    let target: HTMLElement | null = null;
    render(<Owner returnFocus={() => target} />);
    target = screen.getByRole('button', { name: 'Elsewhere' });
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();

    // A target that is no longer on the page: back to the opener.
    target = document.createElement('button');
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
  });

  it('leaves focus to the browser when its opener is gone too', async () => {
    const user = userEvent.setup();
    function Vanishing() {
      const [open, setOpen] = useState(false);
      return (
        <>
          {open ? null : <Button onClick={() => setOpen(true)}>Open once</Button>}
          <Dialog open={open} onClose={() => setOpen(false)} title="Opener gone">
            body
          </Dialog>
        </>
      );
    }
    render(<Vanishing />);
    await user.click(screen.getByRole('button', { name: 'Open once' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(dialog().open).toBe(false);
    expect(screen.getByRole('button', { name: 'Open once' })).not.toHaveFocus();
  });

  it('closes and returns focus when it unmounts while open', async () => {
    const user = userEvent.setup();
    function Unmounting() {
      const [shown, setShown] = useState(false);
      return (
        <>
          <Button onClick={() => setShown(true)}>Open</Button>
          {shown ? (
            <Dialog open onClose={() => setShown(false)} title="Short-lived">
              <Button onClick={() => setShown(false)}>Remove</Button>
            </Dialog>
          ) : null}
        </>
      );
    }
    render(<Unmounting />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('dialog', { name: 'Short-lived' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
  });

  it('does nothing on Tab when it holds no controls but its own', () => {
    function Bare() {
      return (
        <Dialog open onClose={() => undefined} title="Bare" closeLabel="Dismiss">
          text
        </Dialog>
      );
    }
    render(<Bare />);
    const close = screen.getByRole('button', { name: 'Dismiss' });
    act(() => close.focus());
    fireEvent.keyDown(close, { key: 'Tab' });
    expect(close).toHaveFocus();
    // An empty dialog (every control disabled) leaves Tab to the browser.
    close.setAttribute('disabled', '');
    fireEvent.keyDown(dialog(), { key: 'Tab' });
    expect(dialog()).not.toHaveAttribute('aria-describedby');
  });

  it('shows header actions between the title and the close button, outside its name', async () => {
    const user = userEvent.setup();
    render(
      <Dialog
        open
        onClose={() => undefined}
        title="Edit wait approve"
        actions={<Button aria-label="2 issues on approve">2</Button>}
      >
        <Input aria-label="Label" />
      </Dialog>,
    );
    const open = screen.getByRole('dialog', { name: 'Edit wait approve' });
    const header = open.querySelector('header')!;
    const buttons = within(header).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      '2 issues on approve',
      'Close',
    ]);
    // In the Tab order after the heading, before the close button.
    await user.tab();
    expect(buttons[0]).toHaveFocus();
    await user.tab();
    expect(buttons[1]).toHaveFocus();
  });
});
