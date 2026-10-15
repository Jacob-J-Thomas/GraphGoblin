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

Step 06 part 1 (on top of step 05's ordinary paging) removes:

- API composition authority;
- configured HTTP actions;
- catalogue setup metadata;
- client helpers;
- editor origin lookups.

The loader slice of step 06 part 2 is complete: the live loader returns `{manifest, draft}`, validates current exports, graphs and the shipped draft policy, and clones every creation. It reads no configured graphs or support closures. Its only dependency is the installed catalogue directory. File containment, link and size safeguards remain.

Dormant service modules and their standalone tests stay for now. Their configured catalogue dependency is separate from the live loader; a fixture loader excluded from the application build keeps those service tests runnable until deletion. The rest of part 2 (configured allocation/remapping and engine/infrastructure hooks and callbacks) is still pending: removing those dependencies also reaches into the service suites, exceeding this child's roughly 40-file boundary. Steps 07 and 08 own service deletion, including the temporary fixture. Step 09 owns the contracts, reduced manifests, the `template_instances` store and its SQL. No callback or stored-data removal is claimed by this loader slice.

This is an integration state on `feat/format-4-integration`, not a deployable cutover. A store that still holds configured instances would run their loops' triggers as ordinary loops with no template authority. The integration branch never runs against such a store: children use fresh disposable stores, and the cutover deletes configured instances, their loops and runs before any upgraded store starts.

## Consequences

Copied graphs receive no implicit repository authorization. Ordinary scripts and harnesses still have their configured access and provide no new operating-system isolation. Historic journals and reports are not rewritten or reconciled by this child. Later cleanup removes unreachable implementations and packaging entries, while the owner validates the shared cutover separately.
