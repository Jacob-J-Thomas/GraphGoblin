import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Suspense } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { sampleThread } from '@graphgoblin/contracts/testing';
import { event, queuedFields } from '../../__fixtures__/fake-api.js';
import { ThreadViewer } from '../../runs/inspector/ThreadViewer.js';
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

describe('ThreadViewer while a selection is being reconstructed', () => {
  afterEach(() => {
    gate = undefined;
  });

  it('keeps the previous thread mounted, with its own identifiers and a note, until the selected one is rebuilt', async () => {
    // The thread's variables hold a gated object: the preview of the variables at event 3 (a new
    // object, since the patch copies along its path) reads it in the deferred render.
    const thread = sampleThread({ vars: { topic: 'hello', wide: gated([1, 2, 3]) } });
    const events = [
      event(thread.run.id, 1, 'run.queued', queuedFields({ initialThread: thread })),
      event(thread.run.id, 2, 'node.started', {
        nodeId: 'a',
        kind: 'mutate',
        attempt: 1,
        configHash: 'h',
      }),
      event(thread.run.id, 3, 'node.finished', {
        nodeId: 'a',
        patch: [{ op: 'add', path: '/vars/count', value: 1 }],
        durationMs: 1,
      }),
    ];
    const { rerender } = render(
      <Host>
        <ThreadViewer current={thread} events={events} seq={1} />
      </Host>,
    );
    expect(screen.getByText('Thread at event 1')).toBeInTheDocument();
    closeGate();
    rerender(
      <Host>
        <ThreadViewer current={thread} events={events} seq={3} />
      </Host>,
    );
    // The previous thread's body stays, under its own event's title, so open disclosures, the
    // keyboard and the download names keep their place; the note says what is coming.
    expect(screen.getByText('Thread at event 1')).toBeInTheDocument();
    expect(screen.queryByText('Thread at event 3')).not.toBeInTheDocument();
    expect(screen.getByText('Reconstructing the thread at event 3…')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Messages' })).toBeInTheDocument();
    expect(screen.queryByText('Patch from a')).not.toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
    await openGate();
    expect(screen.getByText('Thread at event 3')).toBeInTheDocument();
    expect(screen.queryByText(/Reconstructing the thread/)).not.toBeInTheDocument();
    expect(screen.getByText('Patch from a')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Messages' })).toBeInTheDocument();
  });
});
