# ADR-0039: Format-4 cutover keeps definitions and deletes run history

- Status: Accepted; its conversion mechanics are superseded by [ADR-0040](ADR-0040-explicit-resets-replace-conversion.md) (explicit resets, 2026-10-18)
- Date: 2026-10-17
- Decision: Owner-approved definitions-only server-store cutover for #164 steps 26 and 28.

## Context

Format 4 changes decisions, terminal exits and trigger configuration. Converting execution history would require history normalization, replay mappings, archival manifests and proof across every event and snapshot. The owner explicitly approved deleting run history instead. Existing stores must remain refused at startup until an offline cutover completes.

## Decision

Keep and convert ordinary loops with every published version and draft. Keep secrets and local owner key material, settings, API keys, webhook endpoint IDs/tokens and surviving cron/poll schedule state. Use the composed asynchronous definition upgrader with independent namespaced `v1`/`v2`/`v3` resolutions keyed by stored version/draft ID. Bind stored review hashes to that identity.

Delete all runs, events, snapshots, receipts, inbound events, timers, sessions, child notifications, frozen admission intents and pins, including embedded history. Delete run artifact files and temporary run workspaces under `<dataDir>/workspaces/<runId>` after database commit. Inventory those reserved paths and file hashes in the locked dry run and bind them into the plan hash. Remove only inventoried files/links and empty directories, never recursively and never by following links. Workspace cleanup selects only top-level names matching stored run IDs; inspect lists all other names as left in place, and fixed or templated user directories under those names or outside the data directory remain untouched. Delete configured template instances and their loops/versions/drafts under #165. Do not archive anything inside SQLite; remove earlier database archives. The complete stopped-data backup is the recovery path.

Inspect is read-only under the data-directory lock. It reports conversion states, counts, identities, hashes, reasons, blockers, disarms and a plan hash. Active ordinary runs (queued/running/waiting/paused) and pending ordinary webhook receipts/admission intents must settle in the old build. Template-loop work is deleted and never blocks. No cutover executes or drains work.

Apply requires the same stopped lock, a verified complete independent backup, zero blockers, all review items resolved and an unchanged plan hash. One transaction deletes history/template definitions, applies structural SQL through 0013, rewrites definitions/defaults, disables schedules, stamps completion, and verifies readiness/head/integrity. Failure before commit rolls everything back. After commit, remove inventoried artifact files and temporary workspace entries and read the result back; report a post-commit cleanup failure distinctly with its backup location.

Disable every poll/cron trigger in every retained published definition and draft, and surviving schedule rows. Losing history removes poll dedupe and cron catch-up evidence. Owners re-arm deliberately. Webhooks keep their existing armed state; historical delivery claims are removed with history.

## Supersession and consequences

This supersedes the full-history conversion, replay-map, failed-run-disposition and in-database archive portions of the #164 plan (including its exact history manifest). Earlier ADR text remains intact. Definition rules, frozen definition stages, lock/backup verification, stale/unused-resolution refusal, transactional SQL, startup readiness and restoration safeguards remain in force.

Remove dead history converters, trigger-history rewrites and their tests; retain frozen schema/definition dependencies required by the composed upgrader. No history metadata migration or 0014 is necessary. Draft tokens/config hashes derive from new definition content. Fresh complete format-4 stores are a no-op. Installation, service stop/start, re-arming and recovery remain owner actions; see the [offline guide](../guide/08-offline-upgrade.md).
