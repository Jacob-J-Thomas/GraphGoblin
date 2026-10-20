import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { WebhookDelivery } from '@graphgoblin/contracts';
import { runRecord } from '../../__fixtures__/fake-api.js';
import { renderWith } from '../../__fixtures__/render.js';
import { DeliveryPanel } from './DeliveryPanel.js';
import { formatDateTime } from '../../lib/utils.js';

const delivery: WebhookDelivery = {
  id: 'stable-id',
  channel: { kind: 'webhook', url: 'https://example.test/hook' },
  status: 'pending',
  attempts: 1,
  maxAttempts: 5,
  inFlight: true,
  acknowledgement: 'unknown',
  effectMayHaveHappened: true,
};
describe('delivery in the run inspector', () => {
  it('shows pending acknowledgement independently of succeeded execution', () => {
    renderWith(<DeliveryPanel run={runRecord({ status: 'succeeded', deliveries: [delivery] })} />);
    expect(screen.getByText(/Execution: succeeded/)).toBeInTheDocument();
    expect(screen.getByText('Pending (1/5 attempts)')).toBeInTheDocument();
    expect(screen.getByText(/effect may have happened/)).toBeInTheDocument();
    expect(
      screen.getByText(
        /if duplicate effects are unacceptable; GraphGoblin does not assume they do/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/stable-id/)).toBeInTheDocument();
    expect(screen.getByText('Awaiting acknowledgement.')).toBeInTheDocument();
  });
  it.each(['delivered', 'failed'] as const)(
    'shows the final %s outcome and last error',
    (status) => {
      renderWith(
        <DeliveryPanel
          run={runRecord({
            status: 'succeeded',
            deliveries: [
              {
                ...delivery,
                status,
                attempts: 5,
                inFlight: false,
                acknowledgement: status === 'delivered' ? 'accepted' : 'unknown',
                lastError: {
                  code: 'timeout',
                  message: 'Acknowledgement timed out',
                  retryable: true,
                  acknowledgement: 'unknown',
                },
              },
            ],
          })}
        />,
      );
      expect(
        screen.getByText(
          status === 'delivered' ? 'Delivered after 5 attempts' : 'Failed after 5 attempts',
        ),
      ).toBeInTheDocument();
      expect(screen.getByText(/Acknowledgement timed out/)).toBeInTheDocument();
    },
  );
  it('shows the durable retry time', () => {
    renderWith(
      <DeliveryPanel
        run={runRecord({
          deliveries: [
            {
              ...delivery,
              inFlight: false,
              nextAttemptAt: '2026-10-20T12:00:00.000Z',
              effectMayHaveHappened: false,
            },
          ],
        })}
      />,
    );
    expect(
      screen.getByText(`Next attempt: ${formatDateTime('2026-10-20T12:00:00.000Z')}`),
    ).toBeInTheDocument();
  });
  it('omits the section when no webhook was queued', () => {
    renderWith(<DeliveryPanel run={runRecord()} />);
    expect(screen.queryByText('Webhook delivery')).not.toBeInTheDocument();
  });
});
