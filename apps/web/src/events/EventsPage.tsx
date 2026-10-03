import { Link } from 'react-router';
import { useInboundEvents } from '../api/queries.js';
import { QueryState } from '../components/status.js';
import { Table, Td, Th } from '../components/ui.js';
import { formatDateTime, prettyJson } from '../lib/utils.js';

/** `api`, `run:<runId>`, or `webhook:<endpointId>` as a readable origin. */
function Source({ source }: { source: string }) {
  if (source.startsWith('run:')) {
    const runId = source.slice('run:'.length);
    return (
      <Link to={`/runs/${runId}`} className="text-sky-800 hover:underline">
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
    <div className="space-y-3 p-4">
      <h1 className="text-lg font-semibold">Events</h1>
      <QueryState query={query} what="Events">
        {(items) =>
          items.length === 0 ? (
            <p className="text-sm text-slate-500">No inbound events yet.</p>
          ) : (
            <Table>
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
                    <Td className="text-xs">{formatDateTime(event.receivedAt)}</Td>
                    <Td>
                      <code>{event.type}</code>
                    </Td>
                    <Td className="text-xs">
                      <Source source={event.source} />
                    </Td>
                    <Td className="text-xs">{event.dedupeKey ?? '-'}</Td>
                    <Td className="text-xs">
                      {event.runIds.length === 0 ? (
                        <span className="text-slate-500">none</span>
                      ) : (
                        <ul>
                          {event.runIds.map((runId) => (
                            <li key={runId}>
                              <Link to={`/runs/${runId}`} className="text-sky-800 hover:underline">
                                {runId}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </Td>
                    <Td>
                      <pre className="max-w-md overflow-auto text-xs">
                        {prettyJson(event.payload)}
                      </pre>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )
        }
      </QueryState>
    </div>
  );
}
