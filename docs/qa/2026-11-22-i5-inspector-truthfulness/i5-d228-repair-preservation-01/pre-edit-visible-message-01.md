## SUPPORTING DELTA VERDICT: CHANGES REQUIRED (tests and docs; the spec comment is accepted)

1. **The known faulty expectation (R2-1, from productreview2).** `run-header-status.test.ts:90` expects `updating` when an unverified `succeeded #3` row agrees with a witnessed `succeeded #3` at the known tail. The correct result is `{kind:'event', status:'succeeded', seq:3}`. It should stay `updating` when the row is past what was seen, sits behind a cold cursor, or comes after a resume. A matching receipt still gives `record`. The delta's own `verified=false` cold-cursor (C1) cases (row `failed #5` with hint 5, and empty evidence) stay correct after the repair. **FIX.**
2. **Contract error in `queries.reconnect`.** The test "does not verify … different run" asserts `query.data.id === foreign.id`, which accepts B's body installed under A's cache key. It starts from an empty slot with a different status and sequence, so it passes even though a warm slot at the same position lets B borrow A's receipt (R2-2). **REWRITE:** expect a read error, no cache replacement, A's row, receipts and slot kept, then recovery on a correct same-ID read.
3. **Weakened assertion.** In the corrective R2 test, line 179 was narrowed from `/node-a/` to the exact qualified label. It no longer proves that an event-derived state hides `at node-a`. **STRENGTHEN:** keep the line and add a check that no `/^at /` text appears.
4. **Docs and CHANGELOG** match the current code. They say nothing about what an unverified row at the tail shows, refusing a wrong-ID body at the cache, recovery reads, or late 401s from an older generation. **UPDATE** them with the repairs.
5. The title of the `useRunHeaderStatus` cold-cursor test says "beyond the cold hint", but the row is at the hint (5 = 5). Naming only, so **ACCEPT**. I'm leaving it unchanged so trace names stay stable.
6. The stream and follower retirement tests (G2), the registry cursor-hint and eviction tests, the late cancelled 200/404 tests and the 404-vs-500 tests are sound, with no false positives. **ACCEPT.** None of them covers recovery liveness (R2-3) or a 401 from an older generation.
7. The two-comment correction in `inspector-truthfulness.spec.ts` is accurate: it describes held responses plus animation frames, not React Query consumption. **ACCEPT.** The fixture stays read-only.

This review does not approve the UI implementation.

Now implementing R2-1, R2-2 and R2-3.
