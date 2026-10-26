# D1 duplicate child completion: prior record and current failure

The required API coverage run retains a real-process failure in
`api-coverage-verified.log.txt`: `expected 2 to be 1` for `child_run.finished`,
asserted in `apps/api/src/subloop-restart.test.ts:123`.

The source below was read from the external batch brief on 2026-10-23.
Original source: `%USERPROFILE%/.claude/codex-runs/GraphGoblin/briefs/i01-i07/FOLLOWUPS.md`.
The full external brief is not kept here. This bounded excerpt is retained verbatim.
Source file SHA-256: `f7dd2562413a197f8be5748f5bac741aab3076566eef3f88edfcee79687c47f5`.

```text
- **From the WP-C6 implementer (pending the Sol review's classification):** `apps/web/src/events/EventsPage.tsx:60-69` (WP-G2's file) still renders `run:<id>` sources and `App.test.tsx:29` uses one as a fixture; dead for new Events after #242, remove after G2 merges. `deliverReturns` has no default case, so a stored unknown channel kind wedges finalisation (documented); a clearer refusal at run start could follow. `child_run.finished` can be recorded twice after a crash between recording it and the parent's next event (pre-existing for successful children, now also for failures). `docs/architecture/README.md:135` is stale (`subtype`, exit criteria, loop-back); docs/12 and docs/14 describe the retired chaining as history. The kill-trial restart test adds about 67 s to the api suite.
```

The current `packages/engine/src/handlers/subloop.ts` is unchanged from the base:
base Git blob `3cdc462835bc5435f3d90a422fd855a827aba6f4`, current Git blob `3cdc462835bc5435f3d90a422fd855a827aba6f4`.
Its `finishWithChild` records the child completion before output mapping and the
executor's next event. A kill in that window can execute the same unfinished
visit again. The failed native assertion matches the previously recorded seam.
No child-recovery algorithm or assertion was changed to hide the failure.

The other failure in that run is the 60-second afterEach fixture-cleanup deadline.
It is recorded separately; a generic cleanup timeout is not classified as D-015
without native termination evidence. The bounded isolated diagnosis is retained
in `d1-cleanup-diagnosis.log.txt`: the unchanged mid-wake case passes in isolation
(17.9 seconds; one pass and two filtered cases). This does not turn the failed
full coverage gate green, and the full-run cleanup timeout remains unclassified.
