# WP-C3 round-two verification

Baseline: `d33514fd409ddb57f1617523a9b08d7bd50278e3`, branch
`codex-wp-c3-wake-poll-research`. Execution crossed 2026-10-19/20, Windows,
Node **v22.14.0**, pnpm **12.8.1**. All commands selected Node 22 first. No commits,
Git index changes, owner app/store access, new dependencies or paid turns.

## Before and after

The new `poll-depth.test.ts` real-HTTP/file-backed-SQLite test was run before
production changes ([full redacted output](round2-before.txt)):

```text
pnpm.cmd --filter @graphgoblin/api exec vitest run src/triggers/poll-depth.test.ts --reporter=verbose
Exit 1, 1 failed test
Expected: ["s-a", "s-b"]
Received: []
```

The [post-fix focused API run](round2-fixture-failure.txt) passed 15 tests but failed its 3,000-level fixture:
`JSON.stringify(candidates)` in the source server overflowed. That was a fixture
failure, not a passing product assertion. After constructing wire JSON
iteratively, [all four depth API tests passed](round2-depth-after.txt). The
[domain focused run](round2-domain-focused.txt) passed 11 tests. Full coverage
later passed all tests in both changed packages; see the
[domain](round2-domain-coverage.txt) and [API](round2-api-coverage.txt) transcripts.

## Built API

After `pnpm.cmd build`, the
[native driver](round2-native.mjs.txt) spawned the built `apps/api/dist/main.js`
on **5780**, with a controlled HTTP source on **5781** and a disposable
`%TEMP%/gg-wp-c3-*` store. No harness turn was required: trigger -> input wait ->
exit. API publication and automatic real-time polling were used, without engine
patches or fake clock scheduling.

Two loops independently received `[deep(1100), s-a, s-b]` and
`[mid-a, deep(1100), mid-b]`, each well inside the 64 KiB probe bound. Three polls
admitted both valid keys per loop and refused the deep key with index 0 or 1.
The driver hard-killed its own API process, started a fresh process on the same
store, and observed two more polls with the same successful run IDs. Replacing
the deep candidate with a shallow candidate using **the same key** then admitted
that key once per loop. No successful key was duplicated. Ten diagnostics were
`POLL_ITEM_REJECTED` / `NESTING_DEPTH_EXCEEDED`.

Actual process IDs, request counts, run IDs, stored keys, source byte sizes and
the redacted store path are in [round2-native.json](round2-native.json). Both API
processes and the source server were closed. The store is retained, not deleted.
This is a fresh worker reproduction of the corrected built behavior, distinct
from the review's before-fix native reproduction.

## Coverage gates

| Command                                               | Result                                                          | Lines              | Branches           |
| ----------------------------------------------------- | --------------------------------------------------------------- | ------------------ | ------------------ |
| `pnpm.cmd --filter @graphgoblin/domain test:coverage` | Exit 0; 27 files, 542 passed                                    | 98.43% (1948/1979) | 95.61% (2183/2283) |
| `pnpm.cmd --filter @graphgoblin/api test:coverage`    | Exit 0; 43 passed files, 2 skipped; 678 passed tests, 6 skipped | 97.86% (1788/1827) | 93.04% (1270/1365) |

Coverage was run directly, without Turbo coverage cache. No thresholds or
exclusions changed. Neither package had a coverage test failure to isolate or
disposition under D-015. Existing skipped API cases retain their dispositions.

## Gate history and final results

- Initial `pnpm.cmd typecheck`: exit 0, 20 tasks successful.
- Initial `pnpm.cmd lint`: exit 1, exclusively 23 diagnostics in round-one generated
  scratch `.mjs` files under `apps/api/.tmp`. They were preserved as `.mjs.txt`;
  no maintained source was excluded and no lint rule was suppressed.
- `pnpm.cmd build`: exit 0, 11 successful tasks.
- Changed-file Prettier write: exit 0.

Final `pnpm.cmd typecheck` passed (20 tasks); final `pnpm.cmd lint` passed
(11 tasks). `pnpm.cmd check:docs` passed with generated docs up to date.
`pnpm.cmd check:layers` passed. `pnpm.cmd check:deps` passed with zero errors
and the existing orphan warning for `packages/infrastructure/drizzle.config.ts`.
The final formatting result is in [round2-gates.txt](round2-gates.txt).
`check:docs` is run as requested although no node schema or route changed.
No license/token/browser gate is needed: no dependency or web source changed.

## Scope and caveats

`POLL_ITEM_MAX_NESTING_DEPTH` is **1000 - 4 = 996**, counting nested containers
below the candidate root. The helper's iterative JSON walk validates full JSON
before classifying depth, so malformed values/keys still fail the entire batch.
Only the classified structural refusal is skipped. Untyped and storage
admission failures retain stop-the-tail behavior. At most 200 fixed-shape
candidate diagnostics are emitted per poll, with no payload fields.

`docs/05` does not describe poll-items admission and is unchanged; docs/08 and
the CHANGELOG explain the fix. No architectural decision or schema change
requires a new ADR or generated reference update.

The lone-surrogate dedupe mismatch is an independent review observation and is
outside this fix. #242 still owns identity-bound child wakes and completed-child
outcome checks. No engine wake/subloop fix was made in this package.

The [temporary-directory inventory](round2-temp-inventory.json) lists matching
`gg-wp-c3-*` names and timestamps, including earlier rounds; it is not a deletion
manifest or an ownership assertion for every matching directory. Coverage
directories also remain for orchestrator cleanup. No directories were manually
deleted.
