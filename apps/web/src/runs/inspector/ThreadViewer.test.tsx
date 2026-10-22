import { render, screen, within } from '@testing-library/react';
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

  it('shows every message of a short thread without controls', () => {
    const { thread, events } = threadOf(MESSAGE_PREVIEW_COUNT, 'c');
    render(<ThreadViewer current={thread} events={events} seq={1} />);
    const list = screen.getByRole('list', { name: 'Messages' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(MESSAGE_PREVIEW_COUNT);
    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /messages/ })).not.toBeInTheDocument();
  });
});
