import { TERMINAL_RUN_STATUSES, type RunRecord } from '@graphgoblin/contracts';
import { Card } from '../../components/ui/index.js';
import { formatDateTime } from '../../lib/utils.js';

export function DeliveryPanel({ run }: { run: RunRecord }) {
  if (!run.deliveries?.length && !TERMINAL_RUN_STATUSES.includes(run.status)) return null;
  return (
    <Card title={run.deliveries?.length ? 'Webhook delivery' : 'Finalization'}>
      <p role="status">
        {run.finalizedAt && !run.deliveries?.some((delivery) => delivery.status === 'pending')
          ? 'Fully finalized.'
          : 'Execution ended; finalization pending.'}
      </p>
      <p className="text-sm text-muted">Execution: {run.status}. Delivery is tracked separately.</p>
      {run.deliveries?.map((delivery) => (
        <div key={delivery.id} className="grid gap-2">
          <p>{delivery.channel.url}</p>
          <p>
            {delivery.status === 'failed'
              ? `Failed after ${delivery.attempts} attempt${delivery.attempts === 1 ? '' : 's'}`
              : delivery.status === 'delivered'
                ? `Delivered after ${delivery.attempts} attempt${delivery.attempts === 1 ? '' : 's'}`
                : `Pending (${delivery.attempts}/${delivery.maxAttempts} attempts)`}
          </p>
          <p className="text-sm text-muted">Delivery identity: {delivery.id}</p>
          {delivery.inFlight ? <p>Awaiting acknowledgement.</p> : null}
          {delivery.nextAttemptAt && !delivery.inFlight ? (
            <p>Next attempt: {formatDateTime(delivery.nextAttemptAt)}</p>
          ) : null}
          {delivery.lastError ? (
            <p>
              {delivery.lastError.code}: {delivery.lastError.message}
            </p>
          ) : null}
          {delivery.acknowledgementUncertain ||
          (delivery.inFlight && delivery.acknowledgement === 'unknown') ? (
            <p>
              An acknowledgement was unknown; the effect may have happened. Receivers must implement
              their own deduplication if duplicate effects are unacceptable; GraphGoblin does not
              assume they do.
            </p>
          ) : null}
        </div>
      ))}
    </Card>
  );
}
