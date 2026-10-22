import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
        'No run was started. An authored key stays consumed; unkeyed redeliveries are separate deliveries.',
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

it('shows safe pinned webhook configuration and explains unavailable history', async () => {
  const api = new FakeApi();
  const endpoint = {
    id: 'endpoint',
    ownerId: 'local',
    loopId: 'loop',
    versionId: 'version',
    triggerNodeId: 'hook',
    path: '/hooks/token',
    enabled: false,
    createdAt: TS,
    authentication: {
      type: 'hmac-sha256' as const,
      message: 'body' as const,
      header: 'x-hub-signature-256',
      secretRef: 'secret-name',
    },
  };
  api.inbound = [true, false].map((configurationAvailable, index) => ({
    id: String(index),
    ownerId: 'local',
    type: 'webhook',
    payload: null,
    receivedAt: TS,
    source: 'webhook:endpoint',
    runIds: [],
    webhook: {
      ...endpoint,
      configurationAvailable,
      ...(configurationAvailable
        ? {
            body: { type: 'json' as const },
            eventType: { source: 'header' as const, name: 'x-event', fallback: 'webhook' },
            dedupeKey: 'id',
          }
        : {}),
    },
  }));
  renderApp('/events', api);
  const headings = await screen.findAllByText('Webhook configuration');
  const available = headings[0]!.closest('details')!;
  available.open = true;
  const region = within(available).getByRole('region', { name: 'Webhook configuration' });
  expect(region).toHaveTextContent('secret-name');
  expect(region).toHaveTextContent('x-event');
  expect(region).toHaveTextContent('dedupeKey');
  expect(region).toHaveAttribute('tabindex', '0');
  const unavailable = headings[1]!.closest('details')!;
  unavailable.open = true;
  expect(
    within(unavailable).getByText('Configuration unavailable for this delivery.'),
  ).toBeVisible();
});

it('lays out a large payload within the cell bound and offers the exact value (#259)', async () => {
  const user = userEvent.setup();
  const api = new FakeApi();
  const payload = { items: Array.from({ length: 300 }, (_, i) => ({ i, text: 'p'.repeat(64) })) };
  api.inbound = [
    {
      id: 'big',
      ownerId: 'local',
      type: 'issues',
      payload,
      receivedAt: TS,
      source: 'api',
      runIds: [],
    },
  ];
  renderApp('/events', api);
  const cell = await screen.findByTestId('payload-big');
  expect(cell.textContent?.length).toBe(1_025);
  expect(screen.getByText(/Showing the first 1,024 of [\d,]+ characters\./)).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Download Payload of event big as JSON' }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Show all of Payload of event big' }));
  const region = screen.getByRole('region', { name: 'Payload of event big' });
  expect(JSON.parse(region.textContent ?? '')).toEqual(payload);
});
