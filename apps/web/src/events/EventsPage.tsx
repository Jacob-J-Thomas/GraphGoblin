import { useInboundEvents } from '../api/queries.js';
import { QueryState } from '../components/status.js';
import { Table, Td, Th } from '../components/ui.js';
import { formatDateTime, prettyJson } from '../lib/utils.js';

/** Recent events received on the inbound bus (POST /events and, from M6, webhooks). */
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
                  <Th>Dedupe key</Th>
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
                    <Td className="text-xs">{event.dedupeKey ?? '-'}</Td>
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
