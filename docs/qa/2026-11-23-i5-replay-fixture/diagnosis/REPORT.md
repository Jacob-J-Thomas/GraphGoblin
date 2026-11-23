Confirmed fixture synchronization race in CI45085137009; no production repair is justified by this captured failure.

The review opened at00:11:18.768 using the browser's running record/recovery sequence12. Later browser GETs began at18.880 and returned succeeded, finalized record/recovery sequence18. The replay POST at18.905 still submitted frozen12 and received409 RECOVERY_STALE. The original fixture awaited the event-qualified succeeded header and test-side finalizedAt reads, not a browser full-record commit.

RunControls.tsx:85 intentionally freezes the review's sequence; run-manager.ts:1745-1748 correctly refuses a changed sequence before fork admission. Do not weaken this guard or silently update an already-reviewed token.

Root's six-added-line fixture correction waits for exact DeliveryPanel execution text stating succeeded, then exact Fully finalized status, before opening Replay. DeliveryPanel.tsx:5-14 and RunInspectorPage.tsx:220-221,265,332 show that those two observations and RunControls consume the same full query record. Requiring succeeded as well as finalized excludes the earlier failed run's finalization. All original consent, marker,202,new-run,source-history and timeout assertions remain.

The CI failure (489 pass/1 declared skip/1 failure), original trace and source baseline remain preserved. This diagnosis did not run a test or mutate source/index/provider/GitHub. Root owns the actual correction, opposing review and fresh CI; independent targeted QA follows separately.
