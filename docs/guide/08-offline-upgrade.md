# Upgrade exports and device drafts to format 4

The portable export command and API import compose frozen 1?2?3 stages with the
V3?V4 definition converter. Format-2 input starts at 2?3; format-3 input starts at
3?4. Format-4 input must pass the current schema. Exports always use format 4;
context-thread schema version remains 1.

**Server stores remain a separate cutover.** Startup and offline apply still refuse
stores that are not complete format-4 stores (`DATA_UPGRADE_REQUIRED`). Choosing
full-history conversion or definitions-only conversion, final SQL apply, history,
manifest approval and installed-instance rehearsal remain owner work. A converted
export does not authorize or perform a database upgrade.

## Convert a portable export

After `pnpm.cmd build`, choose a new output path; existing files are never overwritten:

```powershell
pnpm.cmd graphgoblin-upgrade export --input .\old-loop.json --out .\converted-loop.json
```

A successful result is a format-4 export, or a format-4 bare definition when the
input was bare. Straightforward triggers, classifier decisions, Choice expressions
and unconditional terminal exits can convert automatically. LLM instructions,
Noul route expressions, conditional or repeating exits, webhook decoding, trigger
filters and output consumers may require review. The exact report is authoritative;
a syntactically valid candidate alone does not establish equivalent behavior.

Exit code 2 produces `graphgoblin-upgrade-refusals` with `issues`, automatic-change
`notices` and `reviewItems`. Items list stable `id`, SHA-256 `hash`, source `path`,
`reason`, proposed value and status. No candidate definition is included while
anything is pending or invalid. Resolve every reported item, then retry with a
new output path and `--resolutions .\resolutions.json`.

Resolution files use three independent optional namespaces:

- `v1`: the frozen 1?2 `decisions`, `sources` and `opaqueConsumers` maps. Decision
  replacements preserve the original route IDs; source replacements name exact
  pointers. Opaque consumer approvals contain a nonblank reason and require
  external consumer review.
- `v2`: the frozen 2?3 `predicates` map, keyed by exact criterion pointers such as
  `/nodes/2/config/criteria/0`. Provider predicates need authored Noul side criteria;
  ambiguous expressions need an explicitly boolean `jsonata` rewrite.
- `v3`: the E2 converter's map from review item ID to
  `{hash, action: "approve" | "replace" | "remove", reason, value?}`. Use the exact
  reported hash. Replacement requires `value`; removal is supported only where
  the item explicitly permits it. Graph and source replacements must respect
  the converter's overlap rules.

For example, `{ "v1": { "sources": { "/reported/path": "reviewed source" } },
"v3": { "/reported/path:output-consumer": { "hash": "reported SHA-256",
"action": "approve", "reason": "Reviewed this exact proposal" } } }`.
Earlier-stage rewrites can expose further v3 review items on the next attempt.
Portable v3 reviews use a `portable:` identity derived from the canonical parsed source hash, including filter graph reviews; server-version manifest approvals cannot be reused here.
Flat legacy resolution keys, malformed, stale, conflicting and unused resolutions
are refused. Review the complete loop and external consumers; hashes bind a
proposal to its source, not to the truth of an owner's assessment.

API import converts old exports automatically when no review is pending. Otherwise
it returns `400 LOOP_FORMAT_UPGRADE_REQUIRED` with `errors.issues` and
`errors.reviewItems`, including IDs, hashes and reasons. API-supplied resolutions
are unsupported; use the offline command and import its completed format-4 output.
The MCP server has no import tool.

## Retained database tooling

The following inventory, manifest, apply and recovery descriptions document the
retained earlier tooling. They do not provide a format-4 server cutover: apply
continues to refuse an older store. Do not alter markers to bypass that refusal.

## Inventory and approve a stopped database

Drain or cancel **every queued, running, waiting and paused run with the old build**, then stop its service. The tool acquires the same data-directory lock as GraphGoblin and refuses a live owner. Identify both the complete data directory and the actual local database URL, including an external database if configured. Do not point the command at a different directory to bypass a lock.

The examples below use placeholder paths. Put inventory, manifest and audit files outside the data directory, in a private local folder. They contain workflow definitions and historical context. Backups also contain encrypted secrets and their local encryption material.

```powershell
pnpm.cmd graphgoblin-upgrade inventory --data-dir C:/GraphGoblin/data --db-url file:C:/GraphGoblin/data/graphgoblin.db --out C:/GraphGoblin/upgrade/inventory.json
```

Inventory and audit open the database through a native read-only connection. Inventory reads all stored versions, including hidden or deleted history, and every run/event. It reports nonterminal runs, structural refusals, affected failed runs, per-version conversion issues and a proposed `manifest` object. Copy that object into a separate manifest file. Preserve `sourceHash` and every `definitionHash`; fill `approvedBy`, an ISO `approvedAt`, and each version's resolutions. A reused node ID in another version needs its own reviewed resolution.

Every affected failed run, including an affected failed parent that invokes a subloop, requires an explicit `nonresumable-replay` disposition and a nonblank reason. Conversion preserves its failure and history but prevents continuing the old execution against changed semantics; start a replay or new run after inspecting the upgraded definition. The tool never cancels runs on your behalf. Resolve orphaned or malformed records through a separate reviewed repair before retrying.

Review and approve the **exact manifest** before applying it. If anything changes in the source database, repeat inventory and approval; stale hashes are refused.

## Apply and inspect

Choose a new backup directory outside the data directory. Apply first makes a complete stopped-data copy and, when needed, copies the external database plus its WAL/SHM files. It verifies file hashes before opening the database. Supply the physical data-directory and database paths: linked data roots, database files, database sidecars, or linked database ancestors are refused before backup creation. Backup containment is checked against the physical parent directory, so an alias cannot place a backup inside the source. Ordinary non-database links in the data tree are preserved as links; their external target contents are not snapshotted. Preserve any such external content separately when it is needed for recovery. Schema migrations, definitions, defaults, events, output patches, initial threads and snapshots are then converted in one transaction. Strict final parsing and replay comparison must pass before commit; a failure rolls back the transaction.

```powershell
pnpm.cmd graphgoblin-upgrade apply --data-dir C:/GraphGoblin/data --db-url file:C:/GraphGoblin/data/graphgoblin.db --manifest C:/GraphGoblin/upgrade/manifest.json --backup-dir C:/GraphGoblin/backups/before-format-3
pnpm.cmd graphgoblin-upgrade audit --data-dir C:/GraphGoblin/data --db-url file:C:/GraphGoblin/data/graphgoblin.db --out C:/GraphGoblin/upgrade/audit.json
```

The database keeps the approved manifest and original converted records with source and manifest hashes. Unknown historical model, effort or probability values stay null; old skip diagnostics remain factual event evidence. Audit exports that record for inspection. A canonical value does not invent provider facts that were never recorded.

The frozen history converter also accepts earlier strategy/route decisions without `skipped` and Codex command progress items containing only `id`, `type` and `summary`. Decisions with no recorded skips receive an empty canonical diagnostics list; this does not establish that no strategies were skipped. Statusless command items become generic `other` progress items with their original ID and summary, because current command items require a status that was never recorded. No status or exit code is inferred from the summary. The audit retains the original command classification and complete source event. All other statusless item types (`message`, `file-change`, `reasoning`, `tool-call`, `search`, `error`, `other`) pass through unchanged except that historical error summaries become `Harness reported an error` and tool-call summaries omit the diagnostic text after `failed:`, matching current emission rules. IDs and recorded statuses remain factual; the complete original summaries stay in the upgrade audit. Script progress and commands with recorded lifecycle facts remain unchanged. Runtime event parsing remains strict.

Before restarting, replace `GG_DEFAULT_MODEL` and `GG_DEFAULT_EFFORT` with `GG_DEFAULTS`, for example `{"byHarness":{"codex":{"model":"gpt-6-luna","effort":"low"}}}`. The old environment variables produce `CONFIGURATION_UPGRADE_REQUIRED`. Owner settings are converted from `defaultModel`/`defaultEffort` to `defaults` in the transaction. Review models and efforts against the current catalog.

Test the result in an isolated instance before replacing your working installation. Keep cron, poll and hook triggers disarmed and bind every writable workspace to an independent disposable clone: copying the database does not isolate the paths or external destinations in its loops. Inspect converted drafts and completed/failed run histories, compare full replay with stored checkpoints, then run a bounded example against safe destinations. Do not overwrite the original instance or enable copied triggers as part of this check.

Restoring the pre-upgrade backup discards every edit and run created after that backup. To roll back, stop the new instance and restore the **complete** stopped-data backup and any external database files to a separate recovery location using the old build. Preserve the failed upgrade copy for diagnosis. Never run the old build on a partially restored or converted database. Re-inventory and approve a new attempt after correcting the cause.

## Browser drafts and converter lifetime

Opening the editor converts automatic old device drafts once, archives and reads
back the exact original before replacing an active or set-aside key, and marks the
current copy unsynced. Old server tokens are discarded: the first autosave gets a
conflict and requires **Reload server draft** or **Overwrite with this copy** using
a fresh server token. Set-aside restoration is also an explicit overwrite choice.

Pending, incomplete or failed old conversions remain inert raw copies with review
issues and **Export original device copy**. Archived originals stay inert. Failed
archival or readback blocks overwriting autosave. Incomplete current drafts still
reopen for editing. The IndexedDB drafts store is preserved across version upgrades. A raw device-copy
export includes its metadata and tokens; keep that original file and copy its
`definition` field into a separate input file for the offline export command.

The session-storage run-event cache and SSE cursor use the current format in their
key; old keys are removed, forcing a fresh replay. There is no old-event reader.
API responses are not cached by the service worker; React Query state is in memory.

This converter remains available through the cutover release. It can be retired no earlier than the next incompatible release with an upgrade notice. Old exports after retirement require the appropriate older converter/build; runtime parsing does not keep a legacy decision executor.

## Verify the converter

After `pnpm build`, run `pnpm test:upgrade` for the offline command acceptance checks. CI runs these checks after the build. They use disposable stores to verify refusal, original-file preservation, stopped-instance locking, complete backups, rollback, restoration, and re-upgrade. They do not read or convert your installed instance.

## Structural readiness of earlier development stores

The retained GitHub-trigger converter handles historical endpoint signing schemes, durable webhook receipts and an indexed trigger dedupe lookup. The current format-4 baseline is SQL 0013: endpoints have recipe CHECKs and the raw-content receipt index is non-unique. Body, event extraction and explicit key configuration live in the pinned definition. Earlier development stores remain refused until the integrated cutover; changing a version marker or allowing ordinary startup migrations is not a substitute. Normal startup checks structure before migrations, recovery or arming triggers.

The inventory refuses every nonterminal run and pending webhook admission. Existing canonical decision history is preserved. Old default timestamp-signature dedupe keys are converted only when endpoint, version, node and signing configuration prove their origin and no authored dedupe expression overrides the default. Custom keys remain unchanged; missing or ambiguous provenance stops conversion. Disabled endpoints left by ordinary loop deletion may remain unchanged only when the loop, its versions and runs are absent and every retained delivery has an empty, well-formed run-link list. Their keys are not inferred or rewritten. Enabled endpoints, surviving execution references and inconsistent live-loop provenance still refuse conversion. The manifest transaction applies structural and fact changes together, retaining its source audit.
