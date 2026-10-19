import type { UseInfiniteQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ErrorState, QueryState } from './status.js';
import { Button } from './ui/index.js';

/** Append failures retain the loaded rows and reading position, with an explicit retry. */
export function HistoryState<T>({
  query,
  what,
  children,
}: {
  query: UseInfiniteQueryResult<T[]>;
  what: string;
  children: (items: T[]) => ReactNode;
}) {
  return (
    <>
      <QueryState query={query} what={what} keepDataOnError={query.isFetchNextPageError}>
        {children}
      </QueryState>
      {query.isFetchNextPageError ? <ErrorState error={query.error} what={what} /> : null}
      {query.data && query.data.length > 0 ? (
        // Keep the footer height at exhaustion so the browser cannot clamp the reading position.
        <div className="min-h-9 pointer-coarse:min-h-11">
          {query.hasNextPage ? (
            <Button
              variant="outline"
              aria-disabled={query.isFetching}
              aria-busy={query.isFetchingNextPage}
              onClick={() => {
                if (!query.isFetching) void query.fetchNextPage({ cancelRefetch: false });
              }}
            >
              {query.isFetchingNextPage ? 'Loading more...' : 'Load more'}
            </Button>
          ) : (
            <p role="status" className="text-sm text-muted">
              All {what.toLowerCase()} loaded.
            </p>
          )}
        </div>
      ) : null}
    </>
  );
}
