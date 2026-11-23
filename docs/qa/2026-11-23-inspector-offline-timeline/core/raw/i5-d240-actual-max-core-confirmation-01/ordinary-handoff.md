# ACCEPT

Verdict for the named delta `30820901..458f6cb0` (two paths): B1 is resolved and the S1 comment is now accurate. I found no remaining in-scope blocker. This is a source-reading conclusion; I executed nothing, and it is not a general or UI approval.

## B1: resolved

The on-disk helper matches the diff post-image. `sameRevision` (`inspector-read-provenance.ts:119–122`) now requires only an idle restored state, an equal `dataUpdateCount` and the identical body object. On a match the branch writes nothing except the unchanged `entry.dataCount` (123).

| Schedule | What the helper sees | Result |
| --- | --- | --- |
| Paused before GET, then cancel | The query function never runs, so there is no attempt; the pause records a loss (125–126) and the revert restores the same object and count | Receipt, loss and latch unchanged |
| Transport failure, cancel in retry delay | The attempt has ended and the loss is recorded (208–210); the revert restores the same object and count | Unchanged |
| Real `useRun`, last observer removed, remount offline | Same revert; the remount pauses again and `loss()` returns early (66) | Same `committed`, same `loss`, no GET |

The supplied old-helper output agrees with this reading. The paused case shows `committed` 52 and `loss` 53, adjacent positions, so no GET started. The retry case shows 54 and 56, with one attempt start between them.

## S1: resolved

Line 18 now matches `loss()` (65–70): a new boundary is taken only when no recovery is awaited, and repeated failures keep it. The assertion at test line 182 is unchanged. The semantics were not turned into a latest-failure epoch.

## Limits that still hold, by reading

- **Never raised:** only lines 105–108 and 115 set a nonzero `committed`, and they require a qualifying nonmanual GET commit.
- **No resurrection:** a manual write (94–97), an ineligible body (203) and a refusal (213) zero `committed` first. A later revert finds a match and leaves zero.
- **Loss latch:** restoration does not touch `loss` or `awaitingRecovery`. Only a qualified commit newer than the boundary releases it (114).
- **Credentials:** every rejection, replacement or forget advances `generation` (`api-key.ts:31–35, 52, 55`). An entry preserved through a reverted fetch under rejected credentials can therefore never pass `accepted()` (49–52) again.
- **Owner, cache, removal, stale attempts:** lines 81–85, 158–171 and 187–193 are untouched.
- **Synthetic `Query.setState`:** an internal caller reproducing the same object, count and idle state keeps an existing receipt. This is the root-accepted limitation; it is not prevented.
- **Callers:** in the files I read, nothing cancels, resets or writes the run key. `queries.ts` cancels only settings, loop, validation and inbound-event keys; the stream, live refresh and reachability paths only refetch or invalidate. `apps/web/package.json` lists no persistence, broadcast or devtools package.
- **S1 witness stands by design:** a read started after the boundary but before a later failure in the same outage still compares as newer. The UI must match run, node, failure and visit identity itself.
- **Eviction:** the receipt lasts only as long as the physical query. `createQueryClient` sets no `gcTime`, so a long absence drops body and receipt together.

## Suggestions (non-blocking)

1. **Track the restoration negatives.** The four negatives QA ran exist only in its untracked overlay. The tracked test file has no case where an already retired receipt meets a paused or retry-delay cancellation; its only mismatch case is the reset at lines 212–213. Lines 120–122 are now the whole guard, so consider moving those cases into the tracked file.
2. **`loss` after recovery.** The field is not cleared when a later GET recovers, so it then holds the start of an outage that is already over. A half-sentence telling consumers to compare `committed > loss`, not test `loss > 0`, would help the UI author.

## Evidence boundaries

- **My reading:** 18 files through Read only. I cannot hash files or read git state, so head, tree, the diff pre-image and all SHA-256 values are as supplied.
- **Query-core behaviour is from memory:** revert through `setState` before abort, last-observer cancellation, the 1,000 ms first retry delay and the five-minute default `gcTime`. The first three are corroborated by the supplied runs.
- **Author receipts, not mine:**
  - old helper: 22 passed, 3 failed of 25;
  - corrected: 25 of 25;
  - web typecheck, scoped ESLint and Prettier: exit 0.
- **Independent QA receipts, not mine:** the same seven-case fixture gave 3 failed and 4 passed on `308209`, then 7 passed with 0 failed and 0 skipped on `458f6cb`.
- **Formatter delta:** failure locations 265 and 309 match the on-disk lines. Location 373 corresponds to on-disk line 381, which fits formatter-only wraps; I could not read the pre-format source.
- **Inventory qualification:** 41,003 is a tracked descriptor count. 39,235 historical `docs/qa` entries are omitted and were not physically hashed; 1,768 materialized source files were.

## Remaining gates

- **S2:** real-listener eligibility against `RunSnapshotSchema`, actual body shape and large-result parse cost. `client.ts` maps a thrown fetch to status 0 and passes aborts through; how a body-read failure after headers is classified depends on openapi-fetch, which I could not read.
- **S3–S5:** key-switch coverage, the dependency-update gate and the paused-as-loss disposition stay as D240 set them.
- **Delivery:** UI, controls, Timeline, docs and changelog; full web and repository gates including coverage; independent UI review and browser QA; current CI; final audit; signed merge.