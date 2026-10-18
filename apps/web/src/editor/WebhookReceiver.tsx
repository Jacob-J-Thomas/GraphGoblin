import { unwrap } from '@graphgoblin/api-client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../api/context.js';
import { keys } from '../api/queries.js';
import { Button, HelpText } from '../components/ui/index.js';

/** The published receiver is authoritative even when the draft has newer edits. */
export function WebhookReceiver({ loopId, nodeId }: { loopId: string; nodeId: string }) {
  const client = useApi();
  const [revealed, setRevealed] = useState<string>();
  const [status, setStatus] = useState('');
  const query = useQuery({
    queryKey: [...keys.loop(loopId), 'triggers'],
    queryFn: async ({ signal }) =>
      unwrap(
        await client.GET('/loops/{id}/triggers', {
          params: { path: { id: loopId } },
          signal,
        }),
      ),
    retry: false,
  });
  const endpoint = query.data?.webhooks.find(
    (item) => item.triggerNodeId === nodeId && item.enabled,
  );
  const url = endpoint ? new URL(endpoint.path, client.config.baseUrl).href : undefined;
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setStatus('Receiver URL copied.');
    } catch {
      setStatus('Copy failed. Check clipboard access and try again.');
    }
  };

  return (
    <section aria-label="Receiver" className="grid gap-3 rounded-md border border-default p-4">
      <h3 className="font-semibold">Receiver</h3>
      {query.isPending ? (
        <HelpText>Loading receiver…</HelpText>
      ) : query.isError ? (
        <div className="grid justify-items-start gap-2">
          <HelpText>Receiver could not be loaded. Try again.</HelpText>
          <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      ) : url ? (
        <>
          <HelpText>
            Other programs send POST requests to this URL to start the loop. The URL contains a
            secret token, so treat it like a password. This is the published receiver; publish again
            to apply draft changes.
          </HelpText>
          <output aria-label="Receiver URL" className="break-all font-mono text-sm">
            {revealed === url ? url : `${new URL(url).origin}/hooks/••••••••`}
          </output>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setRevealed(revealed === url ? undefined : url)}
            >
              {revealed === url ? 'Hide' : 'Reveal'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void copy(url)}>
              Copy receiver URL
            </Button>
          </div>
        </>
      ) : (
        <HelpText>The receiver URL appears after publishing an enabled webhook trigger.</HelpText>
      )}
      <p role="status" aria-live="polite" className="text-sm">
        {status}
      </p>
    </section>
  );
}
