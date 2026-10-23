import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sampleThread } from '@graphgoblin/contracts/testing';
import { event, queuedFields } from '../../__fixtures__/fake-api.js';
import { ThreadViewer } from '../../runs/inspector/ThreadViewer.js';
import { BoundedValue, VALUE_PREVIEW_CHARS } from './bounded-value.js';

// React settles a deferred value within one `act`, which hides the window the tests below are
// about: the renders between a change and its settled preview. Hold the deferred value back on
// demand instead, so that window can be observed.
let held: { value: unknown } | undefined;
vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<Record<string, unknown>>();
  return {
    ...react,
    useDeferredValue: <T,>(value: T) => (held ? (held.value as T) : value),
  };
});

const big = { items: Array.from({ length: 400 }, (_, i) => ({ id: i, note: 'x'.repeat(40) })) };
const other = { items: Array.from({ length: 400 }, (_, i) => ({ id: i, note: 'y'.repeat(40) })) };

describe('BoundedValue while a preview is pending', () => {
  afterEach(() => {
    held = undefined;
  });

  it('shows the placeholder, keeps the previous controls, and finishes the hand-off on settling', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<BoundedValue value={big} label="Variables" testId="value" />);
    await user.click(screen.getByRole('button', { name: 'Show all of Variables' }));
    act(() => screen.getByRole('region', { name: 'Variables' }).focus());
    // The new value arrives but its preview is held back: the text says so, the previous Show
    // all stays mounted, and the keyboard is still inside (the text stays focusable).
    held = { value: big };
    rerender(<BoundedValue value={other} label="Variables" testId="value" />);
    expect(screen.getByTestId('value')).toHaveTextContent('Preparing the preview…');
    expect(screen.getByRole('button', { name: 'Show all of Variables' })).toBeInTheDocument();
    expect(screen.getByTestId('value')).toHaveFocus();
    // The preview settles: the hand-off completes on the new value's Show all.
    held = undefined;
    rerender(<BoundedValue value={other} label="Variables" testId="value" />);
    expect(screen.getByTestId('value').textContent?.length).toBe(VALUE_PREVIEW_CHARS + 1);
    expect(screen.getByRole('button', { name: 'Show all of Variables' })).toHaveFocus();
  });

  it('does not take the keyboard back when the reader leaves while the preview is pending', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <>
        <BoundedValue value={big} label="Variables" testId="value" />
        <button type="button">Elsewhere</button>
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Show all of Variables' }));
    act(() => screen.getByRole('region', { name: 'Variables' }).focus());
    held = { value: big };
    rerender(
      <>
        <BoundedValue value={other} label="Variables" testId="value" />
        <button type="button">Elsewhere</button>
      </>,
    );
    expect(screen.getByTestId('value')).toHaveFocus();
    // The reader tabs away during the wait.
    act(() => screen.getByRole('button', { name: 'Elsewhere' }).focus());
    held = undefined;
    rerender(
      <>
        <BoundedValue value={other} label="Variables" testId="value" />
        <button type="button">Elsewhere</button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
    expect(screen.getByTestId('value')).not.toHaveAttribute('tabindex');
  });
});

describe('ThreadViewer while a selection is being reconstructed', () => {
  afterEach(() => {
    held = undefined;
  });

  it('keeps the previous thread mounted, with a note, until the selected one is rebuilt', () => {
    const thread = sampleThread();
    const events = [
      event(thread.run.id, 1, 'run.queued', queuedFields({ initialThread: thread })),
      event(thread.run.id, 2, 'node.started', {
        nodeId: 'a',
        kind: 'mutate',
        attempt: 1,
        configHash: 'h',
      }),
    ];
    const { rerender } = render(<ThreadViewer current={thread} events={events} seq={1} />);
    expect(screen.getByText('Thread at event 1')).toBeInTheDocument();
    held = { value: 1 };
    rerender(<ThreadViewer current={thread} events={events} seq={2} />);
    expect(screen.getByText('Thread at event 2')).toBeInTheDocument();
    expect(screen.getByText('Reconstructing the thread at event 2…')).toBeInTheDocument();
    // The previous thread's body stays, so open disclosures and the keyboard keep their place.
    expect(screen.getByRole('list', { name: 'Messages' })).toBeInTheDocument();
    held = undefined;
    rerender(<ThreadViewer current={thread} events={events} seq={2} />);
    expect(screen.queryByText(/Reconstructing the thread/)).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Messages' })).toBeInTheDocument();
  });
});
