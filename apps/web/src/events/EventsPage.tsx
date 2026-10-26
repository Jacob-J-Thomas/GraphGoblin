import { HistoryState } from '../components/HistoryState.js';
import { Link, useSearchParams } from 'react-router';
import { useRef } from 'react';
import { useInboundEvents } from '../api/queries.js';
import { Page, PageHeader } from '../components/layout/index.js';
import {
  Badge,
  Button,
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
type InboundEvent = NonNullable<
  ReturnType<typeof useInboundEvents>['data']
>['pages'][number]['items'][number];
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
 * External Events and webhook deliveries, their selected recipients and admission progress.
 */
export function EventsPage() {
  const [params, setParams] = useSearchParams();
  const refreshRef = useRef<HTMLButtonElement>(null);
  const type = params.get('type');
  const before = params.get('before');
  const filters = { ...(type ? { type } : {}), ...(before ? { before } : {}) };
  const query = useInboundEvents(filters);
  const busy = query.isFetching || query.isRefreshing;
  const status = [
    query.isRefreshing
      ? 'Refreshing events…'
      : query.refreshFailed
        ? 'Refresh failed. Your current events are still shown. Refresh to try again.'
        : query.hasRefreshed && !query.newerAvailable
          ? 'Showing the newest events.'
          : null,
    query.newerAvailable ? 'New events available' : null,
    query.newerCheckFailed ? 'Could not check for new events. Refresh to try again.' : null,
  ]
    .filter(Boolean)
    .join(' ');
  function clearFilter(name: 'type' | 'before') {
    const next = new URLSearchParams(params);
    next.delete(name);
    refreshRef.current?.focus({ preventScroll: true });
    setParams(next);
  }
  return (
    <Page>
      <PageHeader
        title="Events"
        actions={
          <Button
            ref={refreshRef}
            variant="outline"
            aria-disabled={busy}
            aria-busy={busy}
            onClick={() => {
              if (!busy) query.refresh();
            }}
          >
            Refresh
          </Button>
        }
      >
        <span role="status" className="text-sm text-muted">
          {status}
        </span>
      </PageHeader>
      {type || before ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted">
          {type ? (
            <span className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-1">
              <span className="min-w-0 wrap-anywhere">Type: {type}</span>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Clear type filter"
                onClick={() => clearFilter('type')}
              >
                Clear
              </Button>
            </span>
          ) : null}
          {before ? (
            <span className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-1">
              <span className="min-w-0 wrap-anywhere">Before: {before}</span>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Clear before filter"
                onClick={() => clearFilter('before')}
              >
                Clear
              </Button>
            </span>
          ) : null}
        </div>
      ) : null}
      <HistoryState query={query} what="Events" keepDataOnError>
        {(items) =>
          items.length === 0 ? (
            <p className="text-sm text-muted">
              {type || before ? 'No inbound events match these filters.' : 'No inbound events yet.'}
            </p>
          ) : (
            <Card flush>
              <Table stack="lg">
                <thead>
                  <tr>
                    <Th>Received</Th>
                    <Th>Type</Th>
                    <Th>Source</Th>
                    <Th>Target</Th>
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
                      <Td label="Target" className="text-xs wrap-anywhere">
                        <div className="grid min-w-0 gap-1">
                          {event.target ? (
                            <>
                              <span>
                                Loop{' '}
                                <Link
                                  to={`/loops/${event.target.loopId}/edit`}
                                  className={`${LINK} font-mono`}
                                >
                                  {event.target.loopId}
                                </Link>
                              </span>
                              <span>
                                Entry <code>{event.target.triggerNodeId}</code>
                              </span>
                            </>
                          ) : null}
                          {event.admissionId ? (
                            <span>
                              Admission <code>{event.admissionId}</code>
                            </span>
                          ) : null}
                          {!event.target && !event.admissionId ? (
                            <span className="text-muted">not recorded</span>
                          ) : null}
                        </div>
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
      </HistoryState>
    </Page>
  );
}
