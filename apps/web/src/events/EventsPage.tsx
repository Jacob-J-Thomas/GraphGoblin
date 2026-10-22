import { Link } from 'react-router';
import { useInboundEvents } from '../api/queries.js';
import { Page, PageHeader } from '../components/layout/index.js';
import { QueryState } from '../components/status.js';
import {
  Badge,
  BoundedValue,
  Card,
  CELL_PREVIEW_CHARS,
  Table,
  Td,
  Th,
  type Tone,
} from '../components/ui/index.js';
import { formatDateTime, prettyJson } from '../lib/utils.js';

const LINK = 'touch-target text-link underline-offset-[3px] hover:underline';
type InboundEvent = NonNullable<Awaited<ReturnType<typeof useInboundEvents>>['data']>[number];
type EventDelivery = NonNullable<InboundEvent['delivery']>;

const DELIVERY: Record<EventDelivery['state'], { label: string; tone: Tone; explanation: string }> =
  {
    filtered: {
      label: 'Filtered',
      tone: 'neutral',
      explanation:
        'No run was started. An authored key stays consumed; unkeyed redeliveries are separate deliveries.',
    },
    deduplicated: {
      label: 'Deduplicated',
      tone: 'neutral',
      explanation: 'A previously used key prevented a run; none was started.',
    },
    pending: {
      label: 'Pending admission',
      tone: 'warn',
      explanation: 'Accepted but not yet admitted as a run.',
    },
    admitted: { label: 'Admitted', tone: 'good', explanation: 'A run was admitted.' },
    failed: {
      label: 'Failed',
      tone: 'bad',
      explanation: 'Admission ended with a safe failure code.',
    },
  };

function Delivery({ delivery }: { delivery: InboundEvent['delivery'] }) {
  if (!delivery) return <span className="text-muted">not tracked</span>;
  const info = DELIVERY[delivery.state];
  return (
    <div className="grid justify-items-start gap-1 text-xs">
      <Badge tone={info.tone} title={info.explanation}>
        {info.label}
      </Badge>
      <span className="text-muted">{info.explanation}</span>
      <span>Admission failures: {delivery.attempts}</span>
      {delivery.state === 'pending' && delivery.nextAttemptAt ? (
        <span>Retry at {formatDateTime(delivery.nextAttemptAt)}</span>
      ) : null}
      {delivery.state === 'failed' && delivery.failureCode ? (
        <span>
          Failure: <code>{delivery.failureCode}</code>
        </span>
      ) : null}
    </div>
  );
}

/** `api`, `run:<runId>`, or `webhook:<endpointId>` as a readable origin. */
function Source({ source }: { source: string }) {
  if (source.startsWith('run:')) {
    const runId = source.slice('run:'.length);
    return (
      <Link to={`/runs/${runId}`} className={LINK}>
        run {runId.slice(-6)}
      </Link>
    );
  }
  if (source.startsWith('webhook:')) return <span>webhook delivery</span>;
  return <span>{source}</span>;
}

function WebhookConfiguration({ webhook }: { webhook: InboundEvent['webhook'] }) {
  if (!webhook) return null;
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer touch-target">Webhook configuration</summary>
      {webhook.configurationAvailable ? (
        <pre
          tabIndex={0}
          role="region"
          aria-label="Webhook configuration"
          className="mt-1 max-w-md overflow-auto rounded-md border border-default bg-code-bg px-2 py-1 text-code-fg"
        >
          {prettyJson({
            authentication: webhook.authentication,
            body: webhook.body,
            eventType: webhook.eventType,
            dedupeKey: webhook.dedupeKey,
          })}
        </pre>
      ) : (
        <p>Configuration unavailable for this delivery.</p>
      )}
    </details>
  );
}

/**
 * Events received on the inbound bus: `POST /events`, webhook deliveries, and exit events
 * of other runs, with the runs each one started.
 */
export function EventsPage() {
  const query = useInboundEvents();
  return (
    <Page>
      <PageHeader title="Events" />
      <QueryState query={query} what="Events">
        {(items) =>
          items.length === 0 ? (
            <p className="text-sm text-muted">No inbound events yet.</p>
          ) : (
            <Card flush>
              <Table stack="lg">
                <thead>
                  <tr>
                    <Th>Received</Th>
                    <Th>Type</Th>
                    <Th>Source</Th>
                    <Th>Delivery</Th>
                    <Th>Dedupe key</Th>
                    <Th>Started runs</Th>
                    <Th>Payload</Th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((event) => (
                    <tr key={event.id}>
                      <Td label="Received" className="text-sm whitespace-nowrap text-muted">
                        {formatDateTime(event.receivedAt)}
                      </Td>
                      <Td label="Type" className="wrap-anywhere">
                        <code>{event.type}</code>
                      </Td>
                      <Td label="Source" className="text-sm">
                        <Source source={event.source} />
                        <WebhookConfiguration webhook={event.webhook} />
                      </Td>
                      <Td label="Delivery" className="text-sm">
                        <Delivery delivery={event.delivery} />
                      </Td>
                      <Td label="Dedupe key" className="text-sm wrap-anywhere">
                        {event.dedupeKey ?? '-'}
                      </Td>
                      <Td label="Started runs" className="text-sm">
                        {event.runIds.length === 0 ? (
                          <span className="text-muted">none</span>
                        ) : (
                          <ul>
                            {event.runIds.map((runId) => (
                              <li key={runId}>
                                <Link to={`/runs/${runId}`} className={`${LINK} font-mono`}>
                                  {runId}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                      </Td>
                      <Td label="Payload">
                        <BoundedValue
                          value={event.payload}
                          label={`Payload of event ${event.id}`}
                          previewChars={CELL_PREVIEW_CHARS}
                          fileName={`event-${event.id}-payload`}
                          className="max-w-md"
                          testId={`payload-${event.id}`}
                        />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )
        }
      </QueryState>
    </Page>
  );
}
