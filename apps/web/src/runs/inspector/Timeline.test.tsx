import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { event } from '../../__fixtures__/fake-api.js';
import { Timeline, TIMELINE_ROWS } from './Timeline.js';
const events = Array.from({ length: 512 }, (_, i) =>
  event('run', i + 1, 'run.started', { attempt: 1 }),
);

it('preserves the ordinary accessible event name for an oversized payload marker', () => {
  render(
    <Timeline
      events={[
        { seq: 1, type: 'node.finished', uncached: true, description: 'work, 1 change, 1 ms' },
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
