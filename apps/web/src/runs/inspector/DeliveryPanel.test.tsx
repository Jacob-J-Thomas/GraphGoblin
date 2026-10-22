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
  acknowledgementUncertain: false,
};
describe('delivery in the run inspector', () => {
  it.each([true, false])(
    'shows prior uncertainty after unknown, rejected and accepted attempts (%s)',
    (uncertain) => {
      const final = {
        ...delivery,
        status: 'delivered' as const,
        attempts: 3,
        inFlight: false,
        acknowledgement: 'accepted' as const,
        acknowledgementUncertain: uncertain,
        lastError: {
          code: 'http' as const,
          message: 'Webhook returned HTTP 429.',
          retryable: true,
          acknowledgement: 'rejected' as const,
          httpStatus: 429,
        },
      };
      renderWith(<DeliveryPanel run={runRecord({ status: 'succeeded', deliveries: [final] })} />);
      expect(screen.getByText('Delivered after 3 attempts')).toBeInTheDocument();
      expect(screen.getByText(/HTTP 429/)).toBeInTheDocument();
      if (uncertain) expect(screen.getByText(/An acknowledgement was unknown/)).toBeInTheDocument();
      else expect(screen.queryByText(/An acknowledgement was unknown/)).not.toBeInTheDocument();
    },
  );
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
              acknowledgementUncertain: false,
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
