# D240/S2 outcome addendum — existing decision, no new approval

Root accepted the bounded real-listener API-shape witness on core `458f6cb` after
rechecking 78 original members and 1,768 materialized source files. The corrected
program's first invocation passed three untouched native GET bodies: waiting
(1,609 bytes), same-run completed (1,433 bytes), and a second completed run with
a 1,130,986-byte controlled fake result. Original execution checked strict
RunSnapshotSchema, matching run IDs, client/raw/cache content and committed
receipts 1/2/3 with pending 0 and loss 0. This proves successful API/core eligibility,
not mounted useRun, UI, outage recovery, browser performance or real inference.

The initial lint/format failures and first behavior exit 1 remain. That behavior
run obtained two bodies; completed passed its schema, identity, content and
receipt checks before an extra reference-equality oracle failed. Root admitted
only replacing that oracle with deep cache-versus-untouched-raw equality.
Reason: cache structural sharing need not preserve returned-object identity.
Alternatives declined were changing product cache sharing, removing cache/proof
checks, skipping completed/large bodies, retrying the unchanged wrong oracle or
fabricating responses. All other assertions, deadlines and no-retry policy stayed.
The exact first/corrected fixtures, raw errors and static/execution receipts survive.
[Named correction](raw/i5-416-api-shape-independent-qa-01/ROOT-FIXTURE-CORRECTION.md)

Both listener/store closures succeeded. Automatic review rejected guarded
recursive TEMP removal before execution (`blocked by policy`, no more specific
reason). The safer accepted action checked literal owned roots, containment,
no reparse points and recorded Node absence, then removed files and checked-empty
directories nonrecursively. It exited 0 with both scratch roots absent. It had
already completed when root's retain-cache instruction arrived; no cache-retention
claim or further deletion follows. Original denial, safer script, actual result,
cleanup inventory and ordering are retained.
[Root disposition](raw/i5-416-api-shape-root-disposition-01/DISPOSITION.json)

The preexisting body-consumption classification boundary is parked as
[#561](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/561). Catch placement
is source-confirmed; no native mid-body disconnect or browser failure was
reproduced. Deferral keeps this successful-body witness bounded instead of
changing shared middleware without the required failure/abort/invalid-JSON
controls. No implementation, batch expansion or gate waiver was admitted.
[Published source-only rationale/readback](raw/i5-d240-s2-followup-publication-01/readback.json)

Node parse timings are observations without a threshold or browser claim.
Sparse QA/source inventory and selected-dependency limits remain explicit.
UI/action/outage/browser/geometry, complete unit/coverage/static gates,
independent review/QA, current CI, final audit, signed merge and owner acceptance
remain. This addendum supplies outcomes/rationale under D240 only; it creates
no new decision number, owner approval or delivery-count increment.
