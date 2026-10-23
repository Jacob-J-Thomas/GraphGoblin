import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';
import { useEffect, useRef, type ReactNode } from 'react';
import { ErrorState, QueryState } from './status.js';
import { Button } from './ui/index.js';

type HistoryPage<T> = { items: T[] };

/** Append failures retain loaded rows; exhausted user-initiated paging keeps keyboard focus. */
export function HistoryState<T>({
  query,
  what,
  children,
}: {
  query: UseInfiniteQueryResult<InfiniteData<HistoryPage<T>>>;
  what: string;
  children: (items: T[]) => ReactNode;
}) {
  const endRef = useRef<HTMLParagraphElement>(null);
  const userAppendRef = useRef(false);
  const { hasNextPage, isFetchingNextPage } = query;
  const hasAppended = (query.data?.pages.length ?? 0) > 1;
  useEffect(() => {
    if (!isFetchingNextPage && userAppendRef.current) {
      userAppendRef.current = false;
      if (!hasNextPage && hasAppended) endRef.current?.focus({ preventScroll: true });
    }
  }, [isFetchingNextPage, hasNextPage, hasAppended, query.dataUpdatedAt, query.errorUpdatedAt]);
  return (
    <>
      <QueryState query={query} what={what} keepDataOnError={query.isFetchNextPageError}>
        {(data) => {
          const items = data.pages.flatMap((page) => page.items);
          if (!items.length && (hasNextPage || hasAppended))
            return (
              <p className="text-sm text-muted">
                {hasNextPage
                  ? 'Load more to continue through history.'
                  : `No readable ${what.toLowerCase()} found.`}
              </p>
            );
          return children(items);
        }}
      </QueryState>
      {query.isFetchNextPageError ? <ErrorState error={query.error} what={what} /> : null}
      {query.data ? (
        // Retain footer height at exhaustion so the reading position cannot be clamped.
        <div className="min-h-9 pointer-coarse:min-h-11">
          {hasNextPage ? (
            <Button
              variant="outline"
              aria-disabled={isFetchingNextPage}
              aria-busy={isFetchingNextPage}
              onClick={() => {
                if (isFetchingNextPage) return;
                userAppendRef.current = true;
                void query.fetchNextPage();
              }}
            >
              {isFetchingNextPage ? 'Loading more\u2026' : 'Load more'}
            </Button>
          ) : hasAppended ? (
            <p ref={endRef} role="status" tabIndex={-1} className="text-sm text-muted">
              All {what.toLowerCase()} loaded.
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
