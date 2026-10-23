import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { sampleThread } from '@graphgoblin/contracts/testing';
import { event, queuedFields } from '../../__fixtures__/fake-api.js';
import { LARGE_HISTORY_BYTES } from '../event-store.js';
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

describe('ThreadViewer with a large history', () => {
  const started = (runId: string, seq: number) =>
    event(runId, seq, 'node.started', { nodeId: 'a', kind: 'mutate', attempt: 1, configHash: 'h' });

  it('reconstructs the thread at an event on request only, and remembers the events asked for', async () => {
    const user = userEvent.setup();
    const { thread, events } = threadOf(3, 'a');
    const id = thread.run.id;
    const all = [...events, started(id, 2), started(id, 3)];
    const view = (seq: number, history = all) => (
      <ThreadViewer current={thread} events={history} seq={seq} historyBytes={3_500_000} />
    );
    const { rerender } = render(view(1));
    // Nothing is replayed until asked: the card names the size and the event.
    expect(screen.getByText('Thread at event 1')).toBeInTheDocument();
    expect(screen.getByText(/history holds 3\.5 MB of recorded events/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Messages' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reconstruct the thread at event 1' }));
    expect(screen.getByRole('list', { name: 'Messages' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reconstruct/ })).not.toBeInTheDocument();

    // Another event asks again, at once (no deferred reconstruction, so no "Reconstructing" note).
    rerender(view(3));
    expect(screen.getByText('Thread at event 3')).toBeInTheDocument();
    expect(screen.queryByText(/Reconstructing the thread/)).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Messages' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reconstruct the thread at event 3' }));
    expect(screen.getByRole('list', { name: 'Messages' })).toBeInTheDocument();

    // A return to an event already asked for shows it without asking.
    rerender(view(1));
    expect(screen.getByRole('list', { name: 'Messages' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reconstruct/ })).not.toBeInTheDocument();

    // A newly arrived event that becomes the selection asks too: live updates are explicit.
    rerender(view(4, [...all, started(id, 4)]));
    expect(
      screen.getByRole('button', { name: 'Reconstruct the thread at event 4' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Messages' })).not.toBeInTheDocument();
  });

  it('keeps the keyboard in the viewer across the card and the thread', async () => {
    const user = userEvent.setup();
    const { thread, events } = threadOf(60, 'a');
    const all = [...events, started(thread.run.id, 2)];
    const view = (seq: number) => (
      <>
        <ThreadViewer current={thread} events={all} seq={seq} historyBytes={3_500_000} />
        <button type="button">Elsewhere</button>
      </>
    );
    const { rerender } = render(view(1));
    // Activating Reconstruct from the keyboard hands the keyboard to the thread's controls.
    await user.tab();
    expect(screen.getByRole('button', { name: 'Reconstruct the thread at event 1' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Show all messages' })).toHaveFocus();
    // A live event that becomes the selection replaces the thread with its card: the keyboard
    // lands on the card's button, never on the body.
    rerender(view(2));
    expect(screen.getByRole('button', { name: 'Reconstruct the thread at event 2' })).toHaveFocus();
    // A keyboard elsewhere is left alone, both ways.
    act(() => screen.getByRole('button', { name: 'Elsewhere' }).focus());
    rerender(view(1));
    expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
    rerender(view(2));
    expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
  });

  it('asks again for an event whose reconstruction the viewer no longer remembers', async () => {
    const user = userEvent.setup();
    const { thread, events } = threadOf(3, 'a');
    const id = thread.run.id;
    const all = [...events, ...Array.from({ length: 34 }, (_, i) => started(id, i + 2))];
    const view = (seq: number) => (
      <ThreadViewer current={thread} events={all} seq={seq} historyBytes={3_500_000} />
    );
    const { rerender } = render(view(1));
    // Thirty-four explicit reconstructions: the viewer remembers the last thirty-two.
    for (let seq = 1; seq <= 34; seq += 1) {
      rerender(view(seq));
      await user.click(
        screen.getByRole('button', { name: `Reconstruct the thread at event ${seq}` }),
      );
      expect(screen.getByRole('list', { name: 'Messages' })).toBeInTheDocument();
    }
    rerender(view(1));
    expect(
      screen.getByRole('button', { name: 'Reconstruct the thread at event 1' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Messages' })).not.toBeInTheDocument();
    rerender(view(34));
    expect(screen.getByRole('list', { name: 'Messages' })).toBeInTheDocument();
  });

  it('reconstructs a patch diff whose other half was let go in one activation', async () => {
    const user = userEvent.setup();
    const { thread, events } = threadOf(3, 'a');
    const id = thread.run.id;
    // Event 2 starts node a, event 3 finishes it with a patch; then 33 more started events.
    const finished = event(id, 3, 'node.finished', {
      nodeId: 'a',
      patch: [{ op: 'add', path: '/vars/count', value: 1 }],
      durationMs: 1,
    });
    const all = [
      ...events,
      started(id, 2),
      finished,
      ...Array.from({ length: 33 }, (_, i) => started(id, i + 4)),
    ];
    const view = (seq: number) => (
      <ThreadViewer current={thread} events={all} seq={seq} historyBytes={3_500_000} />
    );
    const { rerender } = render(view(2));
    await user.click(screen.getByRole('button', { name: 'Reconstruct the thread at event 2' }));
    rerender(view(3));
    await user.click(screen.getByRole('button', { name: 'Reconstruct the thread at event 3' }));
    expect(screen.getByText('Patch from a')).toBeInTheDocument();
    // Thirty-one more reconstructions let event 2 go while event 3 is the oldest kept.
    for (let seq = 4; seq <= 34; seq += 1) {
      rerender(view(seq));
      await user.click(
        screen.getByRole('button', { name: `Reconstruct the thread at event ${seq}` }),
      );
    }
    rerender(view(3));
    expect(
      screen.getByRole('button', { name: 'Reconstruct the thread at event 3' }),
    ).toBeInTheDocument();
    // One activation brings both halves back together.
    await user.click(screen.getByRole('button', { name: 'Reconstruct the thread at event 3' }));
    expect(screen.getByText('Patch from a')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reconstruct/ })).not.toBeInTheDocument();
  });

  it('shows the failure of a reconstruction the reader asked for', async () => {
    const user = userEvent.setup();
    const { thread, events } = threadOf(3, 'a');
    const all = [
      ...events,
      started(thread.run.id, 2),
      event(thread.run.id, 3, 'node.finished', {
        nodeId: 'a',
        patch: [{ op: 'remove', path: '/vars/missing' }],
        durationMs: 1,
      }),
    ];
    render(<ThreadViewer current={thread} events={all} seq={3} historyBytes={3_500_000} />);
    await user.click(screen.getByRole('button', { name: 'Reconstruct the thread at event 3' }));
    expect(screen.getByText('The thread cannot be reconstructed at event 3')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reconstruct/ })).not.toBeInTheDocument();
  });

  it('reconstructs automatically at and below the threshold', () => {
    const { thread, events } = threadOf(3, 'a');
    render(
      <ThreadViewer current={thread} events={events} seq={1} historyBytes={LARGE_HISTORY_BYTES} />,
    );
    expect(screen.getByRole('list', { name: 'Messages' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reconstruct/ })).not.toBeInTheDocument();
  });
});
