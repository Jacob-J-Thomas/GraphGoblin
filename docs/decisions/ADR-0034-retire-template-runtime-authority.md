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

Step 06 is complete, with steps 07 (implementation/review services) and 08 (QA services) folded into this child. The loader returns `{manifest, draft}`, validates current exports, graphs and the shipped draft policy, and clones every creation. It reads no configured graphs or support closures. Its only dependency is the installed catalogue directory. File containment, link and size safeguards remain.

Configured services, their tests and the temporary configured-catalogue fixture are deleted. Configured allocation/remapping, script execution identity, engine execution/resume hooks, the SQLite transition callback and the SQLite admission callback are removed. Ordinary lifecycle, environments, stdin/stdout, cancellation, timeouts, output bounds, transactions, compare-and-swap, admission identity, pins and post-commit notifications remain. The API build and image no longer contain private support entry modules, and CI checks installed draft loading and independent copies without running support commands. The generic GitHub poll-items recipe remains.

Step 09 removed the configured contracts, `container.templates.store`, the template-instance facade and the template schema declarations. It adds migration `0012_retire_template_instances` and sets that migration as the format-4 baseline. Step 10 reduced the manifests and removed configured JSON assets. Installed data changes only through the coordinated cutover.

This is an integration state on `feat/format-4-integration`, not a deployable cutover. A store that still holds configured instances would run their loops' triggers as ordinary loops with no template authority. The integration branch never runs against such a store: children use fresh disposable stores, and the cutover deletes configured instances, their loops and runs before any upgraded store starts.

## Consequences

Copied graphs receive no implicit repository authorization. Ordinary scripts and harnesses still have their configured access and provide no new operating-system isolation. Historic journals and reports are not rewritten or reconciled by this child. Configured storage and assets have been removed from the product; the owner validates the shared cutover separately.
