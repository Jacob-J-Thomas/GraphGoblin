import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { StorageStatusSchema } from '@graphgoblin/contracts';
import { unwrap } from '@graphgoblin/api-client';
import { useApi } from '../api/context.js';

/** Cached observation; neither polling nor following the link grants deletion consent. */
export function StorageNotice() {
  const client = useApi();
  const query = useQuery({
    queryKey: ['system', 'storage'],
    queryFn: async ({ signal }) =>
      StorageStatusSchema.parse(
        unwrap(await client.GET('/system/storage', { signal, cache: 'no-store' })),
      ),
    retry: false,
    refetchInterval: 15_000,
    refetchOnWindowFocus: false,
  });
  const status = query.data;
  if (!status || status.state === 'adequate') return null;
  const message =
    status.state === 'unavailable'
      ? 'Storage measurement or cleanup could not finish. Check available disk space; protected resources stay kept.'
      : status.state === 'no-eligible'
        ? 'Storage is low. No approved eligible history could be cleaned. Review history you can remove or free disk space.'
        : 'Storage is low. Cleanup removes only history you marked delete-ready and its owned, unshared resources.';
  return (
    <aside
      role="status"
      aria-live="polite"
      aria-label="Storage pressure"
      className="mx-4 my-2 rounded border border-status-warn-border bg-status-warn-bg px-3 py-2 text-sm text-status-warn-fg"
    >
      <p>
        {message}{' '}
        {status.preservedResources > 0
          ? 'Shared, linked, unproven or deferred resources are kept.'
          : null}
      </p>
      <Link to="/runs" className="text-link underline">
        Review run history
      </Link>
    </aside>
  );
}
