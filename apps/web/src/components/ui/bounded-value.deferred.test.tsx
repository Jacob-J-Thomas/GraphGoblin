import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Suspense } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { BoundedValue, VALUE_PREVIEW_CHARS } from './bounded-value.js';

// React settles a deferred value within one `act`, which hides the window the tests below are
// about: the renders between a change and its settled preview. These tests hold that window open
// the way React itself does: the deferred render suspends. A value whose property getter throws a
// pending promise while the gate is closed suspends the render that first reads it (the preview),
// and React keeps the committed urgent render on screen until the promise settles; the host's
// Suspense fallback never shows for content that was already visible.
let gate: { promise: Promise<void>; open: () => void } | undefined;
function closeGate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  gate = { promise, open };
}
/**
 * An object whose `items` are only readable while the gate is open. Each test makes its own: the
 * preview cache remembers an object once it has been read.
 */
function gated<T>(items: T) {
  return Object.defineProperty({}, 'items', {
    enumerable: true,
    get() {
      // A thrown thenable is how a render suspends.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      if (gate) throw gate.promise;
      return items;
    },
  });
}
async function openGate() {
  const current = gate;
  gate = undefined;
  await act(async () => {
    current?.open();
    await current?.promise;
  });
}

const big = { items: Array.from({ length: 400 }, (_, i) => ({ id: i, note: 'x'.repeat(40) })) };
const another = () =>
  gated(Array.from({ length: 400 }, (_, i) => ({ id: i, note: 'y'.repeat(40) })));

function Host({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<p>Loading…</p>}>{children}</Suspense>;
}

describe('BoundedValue while a preview is pending', () => {
  afterEach(() => {
    gate = undefined;
  });

  it('shows the placeholder, keeps the previous controls, and finishes the hand-off on settling', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <Host>
        <BoundedValue value={big} label="Variables" testId="value" />
      </Host>,
    );
    await user.click(screen.getByRole('button', { name: 'Show all of Variables' }));
    act(() => screen.getByRole('region', { name: 'Variables' }).focus());
    // The new value arrives but its preview cannot be read yet: the text says so, the previous
    // Show all stays mounted, the keyboard is still inside (the text stays focusable), and the
    // Suspense fallback does not replace what was already shown.
    const other = another();
    closeGate();
    rerender(
      <Host>
        <BoundedValue value={other} label="Variables" testId="value" />
      </Host>,
    );
    expect(screen.getByTestId('value')).toHaveTextContent('Preparing the preview…');
    expect(screen.getByRole('button', { name: 'Show all of Variables' })).toBeInTheDocument();
    expect(screen.getByTestId('value')).toHaveFocus();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
    // The preview settles: the hand-off completes on the new value's Show all.
    await openGate();
    expect(screen.getByTestId('value').textContent?.length).toBe(VALUE_PREVIEW_CHARS + 1);
    expect(screen.getByRole('button', { name: 'Show all of Variables' })).toHaveFocus();
    expect(screen.getByTestId('value')).not.toHaveAttribute('tabindex');
  });

  it('does not take the keyboard back when the reader leaves while the preview is pending', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <Host>
        <BoundedValue value={big} label="Variables" testId="value" />
        <button type="button">Elsewhere</button>
      </Host>,
    );
    await user.click(screen.getByRole('button', { name: 'Show all of Variables' }));
    act(() => screen.getByRole('region', { name: 'Variables' }).focus());
    const other = another();
    closeGate();
    rerender(
      <Host>
        <BoundedValue value={other} label="Variables" testId="value" />
        <button type="button">Elsewhere</button>
      </Host>,
    );
    expect(screen.getByTestId('value')).toHaveFocus();
    // The reader tabs away during the wait: the text stops being focusable at once, and the
    // settled preview leaves the keyboard where the reader put it.
    act(() => screen.getByRole('button', { name: 'Elsewhere' }).focus());
    expect(screen.getByTestId('value')).not.toHaveAttribute('tabindex');
    await openGate();
    expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
    expect(screen.getByTestId('value')).not.toHaveAttribute('tabindex');
    expect(screen.getByTestId('value').textContent?.length).toBe(VALUE_PREVIEW_CHARS + 1);
  });
});
