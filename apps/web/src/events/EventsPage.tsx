import { Link } from 'react-router';
import { useInboundEvents } from '../api/queries.js';
import { Page, PageHeader } from '../components/layout/index.js';
import { QueryState } from '../components/status.js';
import { Card, Table, Td, Th } from '../components/ui/index.js';
import { formatDateTime, prettyJson } from '../lib/utils.js';

const LINK = 'touch-target text-link underline-offset-[3px] hover:underline';

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

/**
 * Events received on the inbound bus: `POST /events`, signed webhook deliveries, and exit events
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
                      <Td label="Type">
                        <code>{event.type}</code>
                      </Td>
                      <Td label="Source" className="text-sm">
                        <Source source={event.source} />
                      </Td>
                      <Td label="Dedupe key" className="text-sm">
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
                        <pre className="max-w-md min-w-0 overflow-auto rounded-md border border-default bg-code-bg px-2 py-1 text-xs text-code-fg">
                          {prettyJson(event.payload)}
                        </pre>
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
