import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { sampleThread } from '@graphgoblin/contracts/testing';
import { event, queuedFields } from '../../__fixtures__/fake-api.js';
import { MESSAGE_PREVIEW_COUNT, ThreadViewer } from './ThreadViewer.js';

/** A thread of `n` short messages, each naming its position, seeded as the run's first event. */
function threadOf(n: number, prefix: string) {
  const base = sampleThread();
  const thread = sampleThread({
    messages: Array.from({ length: n }, (_, i) => ({
      ...base.messages[0]!,
      id: `${prefix}${i}`,
      content: `${prefix} message ${i}`,
    })),
  });
  const events = [event(thread.run.id, 1, 'run.queued', queuedFields({ initialThread: thread }))];
  return { thread, events };
}

describe('ThreadViewer messages', () => {
  it('lays out the latest fifty messages, the rest on request, and starts bounded for another thread', async () => {
    const user = userEvent.setup();
    const { thread, events } = threadOf(60, 'a');
    const { rerender } = render(<ThreadViewer current={thread} events={events} seq={1} />);
    const list = () => screen.getByRole('list', { name: 'Messages' });
    expect(within(list()).getAllByRole('listitem')).toHaveLength(MESSAGE_PREVIEW_COUNT);
    expect(within(list()).queryByText('a message 9')).not.toBeInTheDocument();
    expect(within(list()).getByText('a message 10')).toBeInTheDocument();
    expect(within(list()).getByText('a message 59')).toBeInTheDocument();
    expect(screen.getByText('Showing the last 50 of 60 messages.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download messages as JSON' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show all messages' }));
    expect(within(list()).getAllByRole('listitem')).toHaveLength(60);
    expect(within(list()).getByText('a message 0')).toBeInTheDocument();
    expect(screen.getByText('Showing all 60 messages.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show fewer messages' }));
    expect(within(list()).getAllByRole('listitem')).toHaveLength(MESSAGE_PREVIEW_COUNT);

    // Another thread (another event) starts bounded again, even after Show all here.
    await user.click(screen.getByRole('button', { name: 'Show all messages' }));
    const other = threadOf(70, 'b');
    rerender(<ThreadViewer current={other.thread} events={other.events} seq={1} />);
    expect(within(list()).getAllByRole('listitem')).toHaveLength(MESSAGE_PREVIEW_COUNT);
    expect(screen.getByText('Showing the last 50 of 70 messages.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show all messages' })).toBeInTheDocument();
  });

  it('keeps the keyboard in the section when a live append slides a focused message out', async () => {
    const user = userEvent.setup();
    const long = 'x'.repeat(5_000);
    // Message 10 is the oldest shown of 60; its long content gives it a Show all control.
    const build = (n: number) => {
      const made = threadOf(n, 'a');
      made.thread.messages[10]!.content = long;
      return made;
    };
    const first = build(60);
    const { rerender } = render(
      <ThreadViewer current={first.thread} events={first.events} seq={1} />,
    );
    const control = screen.getByRole('button', { name: 'Show all of Message a10 content' });
    act(() => control.focus());
    expect(control).toHaveFocus();
    // One more message arrives: a10 leaves the window, the keyboard lands on the list's control.
    const second = build(61);
    rerender(<ThreadViewer current={second.thread} events={second.events} seq={1} />);
    expect(
      screen.queryByRole('button', { name: 'Show all of Message a10 content' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show all messages' })).toHaveFocus();
    expect(screen.getByRole('list', { name: 'Messages' })).not.toHaveAttribute('tabindex');
    // A keyboard elsewhere is left alone.
    act(() => (document.activeElement as HTMLElement).blur());
    const third = build(62);
    rerender(<ThreadViewer current={third.thread} events={third.events} seq={1} />);
    expect(document.activeElement).toBe(document.body);
    await user.tab();
    expect(document.activeElement).not.toBe(document.body);
  });

  it('shows every message of a short thread without controls', () => {
    const { thread, events } = threadOf(MESSAGE_PREVIEW_COUNT, 'c');
    render(<ThreadViewer current={thread} events={events} seq={1} />);
    const list = screen.getByRole('list', { name: 'Messages' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(MESSAGE_PREVIEW_COUNT);
    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /messages/ })).not.toBeInTheDocument();
  });
});
