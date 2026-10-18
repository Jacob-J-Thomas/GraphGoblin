# ADR-0033: Deleting a loop removes its runs

Status: Accepted from the owner's rescope of #118 (2026-10-14)

## Context

Loop deletion previously removed versions but retained runs referring to those versions.
Upgrade inspection then refused the store with `UPGRADE_ORPHAN_RUN_VERSION` (sweep D5).
The owner chose deletion of run history as the simplest behaviour to develop and maintain,
replacing the proposal to retain hidden, disarmed versions of deleted loops.

## Decision

Delete the loop, drafts, versions, all its runs and their dependent rows in one transaction.
Remove persistent triggers and receipts, and disarm in-memory polls after commit. Refuse
queued, running, waiting and paused runs with 409 `LOOP_IN_USE`. Keep the existing engine
pin-lock protection for active cross-loop callers and pending webhook admissions.

Do not recursively delete runs in other loops. Keep their immutable history; clear a surviving
child's live parent association when its parent is deleted. The parent inspector explains a
missing child. Do not rewrite other published definitions that refer to this loop; future
execution of that subloop reference fails with `SUBLOOP_NOT_FOUND`.

Prune deleted run links from shared inbound deliveries, preserving their historical source.
Deleting any member loop removes the entire configured template-instance binding, rather than
just that member's entry. Other member loops and their histories remain. This is intentional:
the owner's decision in [#165](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/165) deletes
configured template instances entirely at the format-4 cutover.

Artifact references belong to the deleted thread/history; content-addressed files are shared,
have no run ownership, and remain on disk.

Provide a transactional repository operation to remove runs whose loop or version is absent.
The later format-4 cutover will invoke it. Do not change the current offline upgrade here.

## Consequences

Deleting a loop permanently loses its run history. Confirmation states that consequence and
shows a count when the existing run listing is complete. An error rolls back every persistent
change, and triggers remain armed on refusal or rollback. Shared artifact-file reclamation
requires a separate reference-aware policy and is outside this database transaction.
