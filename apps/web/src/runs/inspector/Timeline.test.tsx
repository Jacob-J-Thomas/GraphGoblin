import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { event } from '../../__fixtures__/fake-api.js';
import { timelineEvents, useRunEventStore } from '../event-store.js';
import { Timeline, TIMELINE_ROWS } from './Timeline.js';
const events = Array.from({ length: 512 }, (_, i) =>
  event('run', i + 1, 'run.started', { attempt: 1 }),
);

it('preserves the ordinary accessible event name for an oversized payload marker', () => {
  render(
    <Timeline
      events={[
        {
          seq: 1,
          type: 'node.finished',
          uncached: true,
          description: [{ node: 'work' }, ', 1 change, 1 ms'],
        },
      ]}
      status="live"
      error={undefined}
      selected={undefined}
      onSelect={vi.fn()}
    />,
  );
  const button = within(screen.getByRole('list', { name: 'Timeline' })).getByRole('button', {
    name: /#\s*1\s*node\.finished\s*work, 1 change, 1 ms/,
  });
  expect(button).not.toHaveAccessibleName(/Load exact/);
  expect(button).toHaveAttribute(
    'aria-description',
    'Select to load the exact event payload from the server.',
  );
});
it('names an oversized marker with the pinned labels, not only its recorded IDs (#255)', () => {
  const definition = LoopDefinitionSchema.parse(minimalLoop());
  const node = definition.nodes.find((candidate) => candidate.kind !== 'exit')!;
  const huge = event('run-oversized', 1, 'node.finished', {
    nodeId: node.id,
    patch: [{ op: 'add', path: '/vars/text', value: 'x'.repeat(600_000) }],
    durationMs: 3,
  });
  act(() => useRunEventStore.getState().append('run-oversized', huge));
  const rows = timelineEvents(useRunEventStore.getState().runs['run-oversized']!);
  expect(rows).toHaveLength(1);
  expect('uncached' in rows[0]!).toBe(true);
  expect(JSON.stringify(rows[0]).length).toBeLessThan(20_000);
  render(
    <Timeline
      events={rows}
      definition={definition}
      status="live"
      error={undefined}
      selected={undefined}
      onSelect={vi.fn()}
    />,
  );
  expect(
    within(screen.getByRole('list', { name: 'Timeline' })).getByRole('button', {
      name: new RegExp(`node\\.finished\\s*${node.label} \\(${node.id}\\), 1 change, 3 ms`),
    }),
  ).toBeInTheDocument();
});
it('names oversized markers of many small values with the pinned labels (#186 round 2 audit round 2 B1)', () => {
  const definition = LoopDefinitionSchema.parse({
    ...minimalLoop(),
    nodes: [
      {
        id: 'decide',
        kind: 'decision',
        label: 'Original decision',
        config: {
          kind: 'llm',
          harness: 'codex',
          model: { mode: 'inherit' },
          effort: { mode: 'inherit' },
          instructions: 'Choose',
          routes: [
            { id: 'ship', label: 'Original ship' },
            { id: 'hold', label: 'Original hold' },
          ],
        },
      },
    ],
  });
  const numbers = Array.from({ length: 100_000 }, (_, i) => i);
  const wide = Object.fromEntries(Array.from({ length: 40_000 }, (_, i) => [`k${i}`, `v${i}`]));
  const run = 'run-many-values';
  act(() =>
    useRunEventStore.getState().append(
      run,
      event(run, 1, 'run.woken', { nodeId: 'decide', reason: 'manual', payload: numbers }),
      event(run, 2, 'node.finished', {
        nodeId: 'decide',
        patch: Array.from({ length: 125 }, (_, i) => ({
          op: 'add' as const,
          path: `/vars/${'p'.repeat(200)}${i}`,
          value: 'x'.repeat(5_000),
        })),
        route: 'ship',
        durationMs: 3,
      }),
      event(run, 3, 'heartbeat.beat', { nodeId: 'decide', beat: 1, result: numbers }),
      event(run, 4, 'run.waiting', {
        nodeId: 'decide',
        wait: {
          waitId: 'wide',
          startedSeq: 1,
          nodeId: 'decide',
          kind: 'input',
          inputSchema: { type: 'object', properties: wide },
        },
      }),
      event(run, 5, 'decision.made', {
        nodeId: 'decide',
        portId: 'ship',
        diagnostics: [],
        provenance: {
          kind: 'classifier',
          provider: 'kev',
          classifierId: 'kev',
          model: 'kev-latest',
          effort: null,
        },
        observation: {
          kind: 'classifier',
          answer: { type: 'score', score: 2, confidence: 0.5, legend: wide, probabilities: null },
        },
      }),
      event(run, 6, 'input.received', { nodeId: 'decide', payload: numbers }),
    ),
  );
  const rows = timelineEvents(useRunEventStore.getState().runs[run]!);
  expect(rows.map((row) => 'uncached' in row)).toEqual([true, true, true, true, true, true]);
  for (const row of rows) expect(JSON.stringify(row).length).toBeLessThan(1_000);
  render(
    <Timeline
      events={rows}
      definition={definition}
      status="live"
      error={undefined}
      selected={undefined}
      onSelect={vi.fn()}
    />,
  );
  const list = within(screen.getByRole('list', { name: 'Timeline' }));
  const node = String.raw`Original decision \(decide\)`;
  for (const name of [
    String.raw`run\.woken\s*${node} woken by manual`,
    String.raw`node\.finished\s*${node} → Original ship \(ship\), 125 changes, 3 ms`,
    String.raw`heartbeat\.beat\s*${node}`,
    String.raw`run\.waiting\s*${node} waits for input`,
    String.raw`decision\.made\s*Scored 2 to band Original ship \(ship\) with classifier via kev \(kev-latest\) with confidence 50%`,
    String.raw`input\.received\s*${node}`,
  ])
    expect(list.getByRole('button', { name: new RegExp(name) })).toBeInTheDocument();
});
function Harness() {
  const [following, setFollowing] = useState(true);
  const [selected, setSelected] = useState<number>();
  return (
    <Timeline
      events={events}
      status="live"
      error={undefined}
      selected={selected}
      following={following}
      onPause={() => setFollowing(false)}
      onSelect={setSelected}
      onLive={() => setFollowing(true)}
    />
  );
}
it('windows rows and carries keyboard focus across row boundaries, preserving selection and names', async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const list = screen.getByRole('list', { name: 'Timeline' });
  expect(within(list).getAllByRole('listitem')).toHaveLength(TIMELINE_ROWS);
  const last = within(list).getByRole('button', { name: /#\s*512\s*run\.started\s*attempt 1/ });
  act(() => last.focus());
  await user.keyboard('{Home}');
  expect(
    within(list).getByRole('button', { name: /#\s*1\s*run\.started\s*attempt 1/ }),
  ).toHaveFocus();
  await user.keyboard('{PageDown}');
  expect(
    within(list).getByRole('button', { name: /#\s*81\s*run\.started\s*attempt 1/ }),
  ).toHaveFocus();
  await user.keyboard('{ArrowUp}{Enter}');
  const chosen = within(list).getByRole('button', { name: /#\s*80\s*run\.started\s*attempt 1/ });
  expect(chosen).toHaveFocus();
  expect(chosen).toHaveAttribute('aria-current', 'true');
  await user.click(screen.getByRole('button', { name: 'Follow live' }));
  expect(within(list).getAllByRole('listitem')).toHaveLength(TIMELINE_ROWS);
  expect(
    within(list).getByRole('button', { name: /#\s*512\s*run\.started\s*attempt 1/ }),
  ).toBeInTheDocument();
});
it('keeps live rows at the end and exposes a sequence seek independently of loaded rows', async () => {
  const user = userEvent.setup();
  const select = vi.fn();
  const props = {
    status: 'live' as const,
    error: undefined,
    selected: undefined,
    onSelect: select,
  };
  const { rerender } = render(<Timeline {...props} events={events} />);
  rerender(
    <Timeline {...props} events={[...events, event('run', 513, 'run.started', { attempt: 1 })]} />,
  );
  expect(
    screen.getByRole('button', { name: /#\s*513\s*run\.started\s*attempt 1/ }),
  ).toBeInTheDocument();
  await user.type(screen.getByRole('spinbutton', { name: 'Event sequence' }), '2');
  await user.click(screen.getByRole('button', { name: 'Go to event' }));
  expect(select).toHaveBeenCalledWith(2);
});

/** The text of every polite live region on the page: what a screen reader is told. */
function announced() {
  return [...document.querySelectorAll('[aria-live="polite"]')].map((node) => node.textContent);
}

it('announces pausing and browsing, not every live append (#186 QA)', async () => {
  const user = userEvent.setup();
  const props = { status: 'live' as const, error: undefined, selected: undefined };
  function Following({ count }: { count: number }) {
    const [following, setFollowing] = useState(true);
    return (
      <Timeline
        {...props}
        events={events.slice(0, count)}
        following={following}
        onSelect={vi.fn()}
        onPause={() => setFollowing(false)}
        onLive={() => setFollowing(true)}
      />
    );
  }
  const { rerender } = render(<Following count={400} />);
  const before = announced();
  for (let count = 401; count <= 440; count++) rerender(<Following count={count} />);
  // The visible window text follows the tail; the announcement does not change with it.
  expect(screen.getByText('Showing events 361–440 of the retained window.')).toBeInTheDocument();
  expect(announced()).toEqual(before);
  expect(announced()).toContain('Following live.');
  await user.click(screen.getByRole('button', { name: 'Previous rows' }));
  expect(announced()).toContain('Following paused. Showing events 281–360 of the retained window.');
  await user.click(screen.getByRole('button', { name: 'Follow live' }));
  expect(announced()).toContain('Following live.');
});

it('leaves the row list in one Tab or Shift+Tab from any row (#186 QA)', async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const list = screen.getByRole('list', { name: 'Timeline' });
  const row = within(list).getByRole('button', { name: /#\s*500\s*run\.started/ });
  act(() => row.focus());
  await user.tab({ shift: true });
  expect(screen.getByRole('button', { name: 'Go to event' })).toHaveFocus();
  // Back into the list lands on the row last focused, and Tab leaves it again.
  await user.tab();
  expect(row).toHaveFocus();
  await user.tab();
  expect(list.contains(document.activeElement)).toBe(false);
});

it('keeps keyboard focus on Follow live once it resumes following (#186 QA)', async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const list = screen.getByRole('list', { name: 'Timeline' });
  act(() =>
    within(list)
      .getByRole('button', { name: /#\s*500\s*run\.started/ })
      .focus(),
  );
  const follow = screen.getByRole('button', { name: 'Follow live' });
  act(() => follow.focus());
  await user.keyboard('{Enter}');
  // It cannot act while following, but stays focusable so focus does not fall to the page.
  expect(follow).toHaveAttribute('aria-disabled', 'true');
  expect(follow).not.toBeDisabled();
  expect(follow).toHaveFocus();
  expect(announced()).toContain('Following live.');
});

// Contract-valid sequences of five, six and sixteen digits, with long event types.
const large = [
  event('run', 10_593, 'run.started', { attempt: 1 }),
  event('run', 123_456, 'iteration.incremented', { from: 1, to: 2, targetNodeId: 'start' }),
  event('run', Number.MAX_SAFE_INTEGER, 'return.delivered', { channel: { kind: 'log' } }),
];

it('shows every sequence number in full in a column sized to the widest one shown (#420)', () => {
  render(
    <Timeline
      events={large}
      status="live"
      error={undefined}
      selected={undefined}
      onSelect={vi.fn()}
    />,
  );
  const list = screen.getByRole('list', { name: 'Timeline' });
  // `#` and sixteen digits, in characters of the monospace font: no fixed track, cap or rounding.
  expect(list.style.getPropertyValue('--timeline-seq')).toBe('17ch');
  for (const [row, name] of [
    [large[0]!, /#\s*10593\s*run\.started\s*attempt 1/],
    [large[1]!, /#\s*123456\s*iteration\.incremented\s*iteration 1 → 2 at start/],
    [large[2]!, /#\s*9007199254740991\s*return\.delivered\s*log/],
  ] as const) {
    const button = within(list).getByRole('button', { name });
    expect(button).toHaveAttribute('data-seq', String(row.seq));
    expect(button.className).not.toMatch(/30px/);
    expect(button).toHaveClass('flex-wrap');
    const [seq, type] = [...button.children];
    expect(seq).toHaveTextContent(new RegExp(`^#${row.seq}$`));
    expect(seq).toHaveClass('min-w-[min(var(--timeline-seq),100%)]', 'wrap-anywhere');
    expect(type).toHaveTextContent(new RegExp(`^${row.type.replace('.', '\\.')}$`));
  }
});

it('sizes the sequence column from the rows in the window, not the whole history (#420)', async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const list = screen.getByRole('list', { name: 'Timeline' });
  // Following live shows events 433–512: three digits and `#`.
  expect(list.style.getPropertyValue('--timeline-seq')).toBe('4ch');
  act(() =>
    within(list)
      .getByRole('button', { name: /#\s*512\s*run\.started/ })
      .focus(),
  );
  await user.keyboard('{Home}');
  // Events 1–80: two digits at most.
  expect(list.style.getPropertyValue('--timeline-seq')).toBe('3ch');
  expect(within(list).getByRole('button', { name: /#\s*1\s*run\.started/ })).toHaveFocus();
});

it('keeps keyboard movement, the single Tab stop and selection with long sequences (#420)', async () => {
  const user = userEvent.setup();
  const select = vi.fn();
  render(
    <Timeline
      events={large}
      status="live"
      error={undefined}
      selected={undefined}
      following={false}
      onSelect={select}
    />,
  );
  const list = screen.getByRole('list', { name: 'Timeline' });
  const rows = within(list).getAllByRole('button');
  expect(rows.map((row) => row.tabIndex)).toEqual([-1, -1, 0]);
  act(() => rows[2]!.focus());
  await user.keyboard('{Home}');
  expect(rows[0]).toHaveFocus();
  await user.keyboard('{ArrowDown}{Enter}');
  expect(rows[1]).toHaveFocus();
  expect(select).toHaveBeenCalledWith(123_456);
  await user.keyboard('{End}');
  expect(rows[2]).toHaveFocus();
});

it('ignores controls that cannot act, keeping them focusable (#186 QA)', async () => {
  const user = userEvent.setup();
  const live = vi.fn();
  const select = vi.fn();
  render(
    <Timeline
      events={events}
      status="live"
      error={undefined}
      selected={undefined}
      busy
      following
      onSelect={select}
      onLive={live}
    />,
  );
  const follow = screen.getByRole('button', { name: 'Follow live' });
  await user.click(follow);
  expect(follow).toHaveFocus();
  expect(live).not.toHaveBeenCalled();
  await user.type(screen.getByRole('spinbutton', { name: 'Event sequence' }), '7');
  await user.click(screen.getByRole('button', { name: 'Go to event' }));
  await user.type(screen.getByRole('spinbutton', { name: 'Event sequence' }), '{Enter}');
  expect(select).not.toHaveBeenCalled();
});
