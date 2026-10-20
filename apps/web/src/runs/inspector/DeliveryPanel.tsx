import type { RunRecord } from '@graphgoblin/contracts';
import { Card } from '../../components/ui/index.js';

export function DeliveryPanel({ run }: { run: RunRecord }) {
  if (!run.deliveries?.length) return null;
  return (
    <Card title="Webhook delivery">
      <p className="text-sm text-muted">Execution: {run.status}. Delivery is tracked separately.</p>
      {run.deliveries.map((delivery) => (
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
            <p>Next attempt: {delivery.nextAttemptAt}</p>
          ) : null}
          {delivery.lastError ? (
            <p>
              {delivery.lastError.code}: {delivery.lastError.message}
            </p>
          ) : null}
          {delivery.effectMayHaveHappened &&
          (delivery.acknowledgement !== 'accepted' ||
            delivery.lastError?.acknowledgement === 'unknown') ? (
            <p>
              An acknowledgement was unknown; the effect may have happened. The receiver must
              deduplicate the delivery identity.
            </p>
          ) : null}
        </div>
      ))}
    </Card>
  );
}
