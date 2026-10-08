import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeApi, TS } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';

describe('EventsPage delivery dispositions', () => {
  it('shows the five receipt states, attempts, retry time, safe failure and admitted run link', async () => {
    const api = new FakeApi();
    api.inbound = [
      {
        id: 'filtered',
        ownerId: 'local',
        type: 'issues',
        payload: { action: 'ping' },
        receivedAt: TS,
        source: 'webhook:filtered',
        runIds: [],
        delivery: { state: 'filtered', attempts: 0 },
      },
      {
        id: 'deduplicated',
        ownerId: 'local',
        type: 'issues',
        payload: { action: 'labeled' },
        receivedAt: TS,
        source: 'webhook:deduplicated',
        runIds: [],
        delivery: { state: 'deduplicated', attempts: 1 },
      },
      {
        id: 'pending',
        ownerId: 'local',
        type: 'issues',
        payload: { action: 'labeled' },
        receivedAt: TS,
        source: 'webhook:pending',
        runIds: [],
        delivery: {
          state: 'pending',
          attempts: 3,
          nextAttemptAt: '2026-10-07T18:00:00.000Z',
        },
      },
      {
        id: 'admitted',
        ownerId: 'local',
        type: 'issues',
        payload: { action: 'labeled' },
        receivedAt: TS,
        source: 'webhook:admitted',
        runIds: ['01ARZ3NDEKTSV4RRFFQ69G5FAV'],
        delivery: { state: 'admitted', attempts: 1 },
      },
      {
        id: 'failed',
        ownerId: 'local',
        type: 'issues',
        payload: { action: 'labeled' },
        receivedAt: TS,
        source: 'webhook:failed',
        runIds: [],
        delivery: { state: 'failed', attempts: 4, failureCode: 'ADMISSION_UNAVAILABLE' },
      },
      {
        id: 'legacy',
        ownerId: 'local',
        type: 'issues',
        payload: { action: 'opened' },
        receivedAt: TS,
        source: 'api',
        runIds: [],
      },
    ];

    renderApp('/events', api);

    expect(await screen.findByText('Filtered')).toBeVisible();
    expect(
      screen.getByText(
        'No run was started. This authenticated body stays consumed if you later change the filter.',
      ),
    ).toBeVisible();
    expect(screen.getByText('Deduplicated')).toBeVisible();
    expect(
      screen.getByText('A previously used key prevented a run; none was started.'),
    ).toBeVisible();

    const pending = screen.getByRole('row', { name: /Pending admission/ });
    expect(within(pending).getByText('Accepted but not yet admitted as a run.')).toBeVisible();
    expect(within(pending).getByText('Admission failures: 3')).toBeVisible();
    expect(within(pending).getByText(/Retry at/)).toBeVisible();
    expect(within(pending).getByText('none')).toBeVisible();

    const admitted = screen.getByRole('row', { name: /Admitted/ });
    expect(
      within(admitted).getByRole('link', { name: '01ARZ3NDEKTSV4RRFFQ69G5FAV' }),
    ).toBeVisible();

    const failed = screen.getByRole('row', { name: /Failed/ });
    expect(within(failed).getByText('Admission ended with a safe failure code.')).toBeVisible();
    expect(within(failed).getByText('ADMISSION_UNAVAILABLE')).toBeVisible();
    expect(within(failed).getByText('none')).toBeVisible();

    const legacy = screen.getByRole('row', { name: /opened/ });
    expect(within(legacy).getByText('not tracked')).toBeVisible();
  });

  it.each([
    {
      state: 'admitted' as const,
      runIds: ['01ARZ3NDEKTSV4RRFFQ69G5FAV'],
      terminalText: 'A run was admitted.',
    },
    {
      state: 'failed' as const,
      runIds: [],
      terminalText: 'Admission ended with a safe failure code.',
    },
  ])('refreshes a pending receipt when it becomes $state and stops polling', async (terminal) => {
    const api = new FakeApi();
    const pending = {
      id: 'receipt-1',
      ownerId: 'local',
      type: 'issues',
      payload: { action: 'labeled' },
      receivedAt: TS,
      source: 'webhook:test',
      runIds: [] as string[],
      delivery: { state: 'pending' as const, attempts: 1 },
    };
    api.inbound = [pending];
    const view = renderApp('/events', api);

    try {
      expect(
        await screen.findByText('Accepted but not yet admitted as a run.', undefined, {
          timeout: 5_000,
        }),
      ).toBeVisible();
      expect(api.callsTo('GET', '/events')).toHaveLength(1);

      api.inbound = [
        {
          ...pending,
          runIds: terminal.runIds,
          delivery:
            terminal.state === 'admitted'
              ? { state: 'admitted' as const, attempts: 1 }
              : { state: 'failed' as const, attempts: 2, failureCode: 'ADMISSION_UNAVAILABLE' },
        },
      ];

      expect(
        await screen.findByText(terminal.terminalText, undefined, { timeout: 5_000 }),
      ).toBeVisible();
      if (terminal.state === 'admitted') {
        expect(screen.getByRole('link', { name: '01ARZ3NDEKTSV4RRFFQ69G5FAV' })).toBeVisible();
      } else {
        expect(screen.getByText('ADMISSION_UNAVAILABLE')).toBeVisible();
      }
      expect(api.callsTo('GET', '/events')).toHaveLength(2);

      await new Promise((resolve) => setTimeout(resolve, 2_200));
      expect(api.callsTo('GET', '/events')).toHaveLength(2);
    } finally {
      view.unmount();
      view.queryClient.clear();
    }
  });

  it('stops pending refreshes when the Events page unmounts', async () => {
    const api = new FakeApi();
    api.inbound = [
      {
        id: 'receipt-1',
        ownerId: 'local',
        type: 'issues',
        payload: { action: 'labeled' },
        receivedAt: TS,
        source: 'webhook:test',
        runIds: [],
        delivery: { state: 'pending', attempts: 1 },
      },
    ];
    const view = renderApp('/events', api);

    try {
      expect(
        await screen.findByText('Accepted but not yet admitted as a run.', undefined, {
          timeout: 5_000,
        }),
      ).toBeVisible();
      expect(api.callsTo('GET', '/events')).toHaveLength(1);

      view.unmount();
      await new Promise((resolve) => setTimeout(resolve, 2_200));
      expect(api.callsTo('GET', '/events')).toHaveLength(1);
    } finally {
      view.unmount();
      view.queryClient.clear();
    }
  });
});
