import type { RunEvent } from '@graphgoblin/contracts';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { event } from '../../__fixtures__/fake-api.js';
import { CELL_PREVIEW_CHARS } from '../../components/ui/index.js';
import { ProgressDrawer } from './ProgressDrawer.js';

const R = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

describe('ProgressDrawer', () => {
  it('describes harness items in one line and keeps usage inline', async () => {
    const user = userEvent.setup();
    const events: RunEvent[] = [
      event(R, 3, 'node.progress', {
        nodeId: 'infer',
        progress: {
          item: {
            id: 'c1',
            type: 'command',
            status: 'ok',
            summary: 'pnpm test',
            commandPreview: 'pnpm test',
            exitCode: 0,
          },
        },
      }),
      event(R, 4, 'harness.usage', {
        nodeId: 'infer',
        usage: { inputTokens: 3, outputTokens: 4, cachedInputTokens: 0, reasoningOutputTokens: 0 },
      }),
    ];
    render(<ProgressDrawer events={events} />);
    await user.click(screen.getByRole('button', { name: /Node progress \(1 nodes\)/ }));
    expect(screen.getByText(/Command succeeded: pnpm test \(exit 0\)/)).toBeInTheDocument();
    expect(screen.getByText(/"inputTokens": 3/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument();
  });

  it('lays out a large progress value within the cell bound and wraps every row', async () => {
    const user = userEvent.setup();
    const long = 'x'.repeat(20_000);
    const events: RunEvent[] = [
      event(R, 5, 'node.progress', {
        nodeId: 'infer',
        progress: { item: { id: 'r1', type: 'reasoning', summary: long } },
      }),
    ];
    render(<ProgressDrawer events={events} />);
    await user.click(screen.getByRole('button', { name: /Node progress/ }));
    const value = screen.getByLabelText('Progress of infer at event 5');
    expect(value.textContent?.length).toBe(CELL_PREVIEW_CHARS + 1);
    expect(value).toHaveClass('wrap-anywhere', 'min-w-0');
    // The row itself wraps at any character, so no single-line value can widen the page (#380).
    expect(value.closest('li')).toHaveClass('wrap-anywhere', 'min-w-0');
    await user.click(
      screen.getByRole('button', { name: 'Show all of Progress of infer at event 5' }),
    );
    expect(screen.getByLabelText('Progress of infer at event 5').textContent).toContain(long);
  });
});
