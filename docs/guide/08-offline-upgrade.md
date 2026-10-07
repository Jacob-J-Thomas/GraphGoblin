# Upgrade stored decisions to format 2

Format 2 replaces decision strategy chains with one explicit evaluator, introduces stable option IDs and canonical decision evidence, and moves model defaults under their harness. The normal API accepts only the current format. An old portable export returns `LOOP_FORMAT_UPGRADE_REQUIRED`; an old database stops startup with `DATA_UPGRADE_REQUIRED` before migrations, recovery or triggers run. A genuinely empty database is initialized normally. Context-thread schema version remains 1.

Use the one-off `graphgoblin-upgrade` command from this checkout after `pnpm.cmd build`. It never guesses which evaluator should replace a mixed chain. Keep the old build, original data, and exports until the upgraded copy has passed your acceptance checks. Architecture approval is separate from approval of the actual conversion manifest.

## Convert a portable export

Choose a new output path; the tool refuses to overwrite an existing file:

```powershell
pnpm.cmd graphgoblin-upgrade export --input .\old-loop.json --out .\converted-loop.json
```

A successful result is a format-2 export (or a version-2 definition when the input was a bare definition). Exit code 2 means the output is a refusal report, not an importable loop. Resolve every reported ambiguity in a separate JSON resolutions file, then retry to a different new output path with `--resolutions .\resolutions.json`.

The resolutions object has three optional fields:

- `decisions`: a map from node ID to the complete new decision configuration, including its answer and evaluator. Replacement option IDs must preserve the original route-ID set and edge ports; invalid original IDs need a separately reviewed repair. Mixed chains, invalid old option labels/criteria, and expressions whose string result cannot be proven need an explicit choice.
- `sources`: a map from a reported JSON pointer to the reviewed replacement Liquid or JSONata source. For a decision output, the old `lastOutput.value.route` becomes `lastOutput.value.answer.optionId`; use the source-specific path from the report. An inference result may independently contain `route` or `confidence`, so inspect its producer rather than replacing every matching string. Whole output values, indirect lookups and dynamic consumers need review too, including subloop return values and captured result variables. Replacements must parse, and final definitions must satisfy the clean contract.
- `opaqueConsumers`: a map from script node ID to `{reason:"..."}`, recording why the external command receiving the thread or last output works with the new shape. Review and update the script itself first; a reason is an approval record, not an automatic script rewrite.

Conversion is deliberately conservative. Review the complete loop and any external consumers, not just the reported lines. The converter cannot establish arbitrary program behavior. The [decision reference](../04-node-catalog.md#decision) describes the new contract.

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
pnpm.cmd graphgoblin-upgrade apply --data-dir C:/GraphGoblin/data --db-url file:C:/GraphGoblin/data/graphgoblin.db --manifest C:/GraphGoblin/upgrade/manifest.json --backup-dir C:/GraphGoblin/backups/before-format-2
pnpm.cmd graphgoblin-upgrade audit --data-dir C:/GraphGoblin/data --db-url file:C:/GraphGoblin/data/graphgoblin.db --out C:/GraphGoblin/upgrade/audit.json
```

The database keeps the approved manifest and original converted records with source and manifest hashes. Unknown historical model, effort or probability values stay null; old skip diagnostics remain factual event evidence. Audit exports that record for inspection. A canonical value does not invent provider facts that were never recorded.

Before restarting, replace `GG_DEFAULT_MODEL` and `GG_DEFAULT_EFFORT` with `GG_DEFAULTS`, for example `{"byHarness":{"codex":{"model":"gpt-6-luna","effort":"low"}}}`. The old environment variables produce `CONFIGURATION_UPGRADE_REQUIRED`. Owner settings are converted from `defaultModel`/`defaultEffort` to `defaults` in the transaction. Review models and efforts against the current catalog.

Test the result in an isolated instance before replacing your working installation. Keep cron, poll and hook triggers disarmed and bind every writable workspace to an independent disposable clone: copying the database does not isolate the paths or external destinations in its loops. Inspect converted drafts and completed/failed run histories, compare full replay with stored checkpoints, then run a bounded example against safe destinations. Do not overwrite the original instance or enable copied triggers as part of this check.

To roll back, stop the new instance and restore the **complete** stopped-data backup and any external database files to a separate recovery location using the old build. Preserve the failed upgrade copy for diagnosis. Never run the old build on a partially restored or converted database. Re-inventory and approve a new attempt after correcting the cause.

## Browser drafts and converter lifetime

On opening the new app, the same pure converter upgrades unambiguous device drafts. Ambiguous or incomplete drafts are set aside with their original JSON available for export; resolve them through the offline export command. The editor does not silently select an evaluator. The run-event cache is versioned so old decision events are fetched again from the upgraded server.

This converter remains available through the cutover release. It can be retired no earlier than the next incompatible release with an upgrade notice. Old exports after retirement require the appropriate older converter/build; runtime parsing does not keep a legacy decision executor.

## Verify the converter

After `pnpm build`, run `pnpm test:upgrade` for the offline command acceptance checks. CI runs these checks after the build. They use disposable stores to verify refusal, original-file preservation, stopped-instance locking, complete backups, rollback, restoration, and re-upgrade. They do not read or convert your installed instance.
