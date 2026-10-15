# ADR-0034: Retire configured template runtime authority

Status: Accepted under the owner-approved #165 plan (2026-10-14)

Supersedes the configured-template consequences of [ADR-0027](ADR-0027-bundled-template-instances.md) and [ADR-0028](ADR-0028-editable-template-starting-points.md). Completes the backend retirement decision in [ADR-0030](ADR-0030-templates-are-starting-points.md); the records below remain historical evidence.

## Context

Templates are starting graphs copied into independent ordinary loops. Configured instances, private support effects and implicit credentials contradict that model. The owner requires deletion of configured instances, their loops and all their runs at the joint format-4 cutover, without an archive or private-report exception.

## Decision

Templates are never runnable objects. The only creation action is `POST /templates/:id/draft`, which creates an owner-scoped ordinary loop and draft without publication, runs, children or bindings. Later edits and effects use ordinary nodes and credentials. Shipped drafts use manual triggers, exclude scripts, subloops and heartbeat nodes, and return only to the caller; this shipped policy does not restrict later edits.

The API installs no template credential resolver, authority dispatch, admission or script wrapper, transition policy, reporter or finalization interception. Ordinary lifecycle, return delivery, secret references, transactions, compare-and-swap, pins, admission identity and post-commit notifications are preserved. Generic GitHub polling remains an ordinary recipe.

Catalogue entries expose only `{manifest}`. Configured prerequisite, instantiate and instance endpoints and their client methods disappear. Unknown IDs return 404 `TEMPLATE_NOT_FOUND`; trusted installed-package faults return a fixed sanitized 503 `TEMPLATE_PACKAGE_INVALID`. Removed inputs are rejected, without compatibility paths.

The final loader returns `{manifest, draft: LoopDefinition}`, validates current exports and graphs, and clones each creation. Configured allocation/remapping, settings, bindings, services, support assets and storage are deleted through the bounded #165 children. Existing configured stored data is handled only by the coordinated stopped-store cutover; this decision authorizes no local-instance mutation.

## Implementation boundary

Step 06's first coherent subset removes API composition authority and configured HTTP actions, catalogue setup metadata, client helpers and editor origin lookups. It retains dormant service modules and their standalone tests. Engine/infrastructure hook deletion and draft-only loading/allocation removal require a follow-up split to remain below roughly 40 files. The actual base is `55e8311`, before step 05's ordinary paging; the template store remains connected for those existing run reads until step 05 is integrated. This is an integration state, not a deployable cutover.

## Consequences

Copied graphs receive no implicit repository authorization. Ordinary scripts and harnesses still have their configured access and provide no new operating-system isolation. Historic journals and reports are not rewritten or reconciled by this child. Later cleanup removes unreachable implementations and packaging entries, while the owner validates the shared cutover separately.
