import { act, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { event, FakeApi, queuedFields } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';

it.each([
  { name: 'refresh held after the terminal event', releaseStaleRow: false },
  { name: 'refreshed row has the terminal sequence but stale status', releaseStaleRow: true },
])('shows the terminal header when $name (#386)', async ({ name, releaseStaleRow }) => {
  const api = new FakeApi();
  const run = api.addRun({ status: 'running', lastEventSeq: 2 });
  const runPath = '/runs/' + run.id;
  api.pushEvent(run.id, event(run.id, 1, 'run.queued', queuedFields()));
  api.pushEvent(run.id, event(run.id, 2, 'run.started', { attempt: 1 }));

  let releaseRefresh!: () => void;
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  let blockRefresh = false;
  let heldRequests = 0;
  const returnedRows: { status: string; lastEventSeq: number }[] = [];
  api.override('GET /runs/:id', async (call) => {
    if (blockRefresh) {
      heldRequests += 1;
      await refreshGate;
      const row = api.runs.get(run.id)!;
      returnedRows.push({ status: row.status, lastEventSeq: row.lastEventSeq });
    }
    return api.builtIn(call);
  });

  const view = renderApp(runPath, api);
  try {
    const heading = await screen.findByRole('heading', { name: 'Run ' + run.id });
    const header = heading.closest('header')!;
    expect(header.querySelector('[data-status]')).toHaveAttribute('data-status', 'running');
    const timeline = await screen.findByRole('list', { name: 'Timeline' });
    await within(timeline).findByRole('button', { name: /run.started/ });
    expect(
      api
        .callsTo('GET', runPath + '/events')
        .some((call) => call.headers.get('accept') === 'text/event-stream'),
    ).toBe(true);

    const terminal = event(run.id, 3, 'run.finished', { status: 'succeeded', outcome: 'success' });
    blockRefresh = true;
    api.runs.set(run.id, {
      ...run,
      status: releaseStaleRow ? 'running' : 'succeeded',
      lastEventSeq: terminal.seq,
      currentNodeId: 'refreshed-record-witness',
    });
    act(() => api.pushEvent(run.id, terminal));
    const terminalRow = await within(timeline).findByRole('button', {
      name: /run.finished.*succeeded/,
    });
    expect(terminalRow).toBeVisible();
    expect(terminalRow).toHaveTextContent('#3');
    await waitFor(() => expect(heldRequests).toBeGreaterThan(0), { timeout: 5000 });
    expect(returnedRows).toHaveLength(0);

    if (releaseStaleRow) {
      releaseRefresh();
      await within(header).findByText(/at refreshed-record-witness/);
      expect(returnedRows[0]).toEqual({ status: 'running', lastEventSeq: terminal.seq });
    }

    const badge = header.querySelector('[data-status]');
    console.info(
      '386-baseline-observation',
      JSON.stringify({
        case: name,
        terminalSequence: terminal.seq,
        timelineShowsTerminal: true,
        heldRequests,
        returnedRows,
        refreshedRecordVisible: within(header).queryByText(/at refreshed-record-witness/) !== null,
        headerBadge: badge?.getAttribute('data-status'),
      }),
    );
    expect(badge).toHaveAttribute('data-status', 'succeeded');
  } finally {
    releaseRefresh();
    view.unmount();
  }
});
