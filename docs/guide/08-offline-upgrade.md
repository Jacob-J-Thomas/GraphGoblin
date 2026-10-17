# Upgrade a stopped server store to format 4

The format-4 cutover **keeps definitions and deletes all run history** ([ADR-0039](../decisions/ADR-0039-format-four-definitions-only-cutover.md)). The verified backup of the complete stopped data directory is the recovery copy. Nothing is archived inside the database.

Kept: ordinary loops, every published version and server draft, secrets and owner encryption material, settings, API keys, webhook endpoint IDs/tokens and surviving schedule rows. Definitions become format 4. SQL 0013 maps both webhook signing schemes to the current authentication columns without rotating tokens. Old owner default settings, when present, become harness defaults.

Deleted: every run, event, initial thread, snapshot, receipt, inbound event, timer, harness session, child notification, frozen admission intent and subloop pin, plus files under `artifacts/`. Configured template instances and all their loops, versions and drafts are deleted under #165. Existing in-database upgrade archives are removed too. Template catalogue starting points remain available for creating new ordinary loops.

Every poll and cron in **every retained published version and draft** becomes `enabled: false`; surviving cron schedule rows are disabled too. History no longer supplies poll dedupe or cron catch-up evidence. Review the reported disarm list and re-arm deliberately after reviewing old external items. Webhooks keep their armed state. Historical webhook claims are gone, so a repeated delivery can be admitted again.

## Stop, inspect and settle blockers

First settle queued, running, waiting and paused runs of ordinary loops in the **old build**, and finish its pending webhook receipts/admission intents. Stop the instance and any service that restarts it. Template-loop runs and receipts are retired and never block. The upgrade tool does not run workflows or settle ordinary work for you.

Build the new checkout with `pnpm.cmd build`. The commands below use placeholder physical paths, never your live installation by default. Set both paths explicitly, including an external database if configured. Keep reports and resolutions in an existing private folder outside the data directory.

```powershell
pnpm.cmd graphgoblin-upgrade inspect --data-dir C:/GraphGoblin/data --db-url file:C:/GraphGoblin/data/graphgoblin.db --out C:/GraphGoblin/upgrade/inspect.json
```

Inspect acquires the server's directory lock and opens SQLite natively read-only. It reports table/definition/deletion counts, artifact filenames and hashes, every version and draft's conversion state, pending IDs/hashes/reasons, ordinary blockers, trigger disarms and `planHash`. A complete current store reports `status: "current"`: nothing needs doing. A claimed current marker with incomplete structure is refused; never edit markers to bypass this check.

Inspect does not apply SQL or make rollback-only source writes. A changed source, structure, migration catalogue, resolution or artifact set changes the plan hash. Use a new output filename on each attempt; outputs are never overwritten.

## Resolve review items

Server resolution files are keyed by **version or draft ID**, with independent `v1`, `v2` and `v3` namespaces inside each entry. For example:

```json
{
  "VERSION_OR_DRAFT_ID": {
    "v3": {
      "/nodes/0/config:webhook-json-decoding": {
        "hash": "EXACT_REPORTED_SHA256",
        "action": "approve",
        "reason": "Reviewed strict UTF-8 and nonempty JSON behavior for this endpoint"
      }
    }
  }
}
```

Use the exact item IDs and hashes from this store inspection. Reused node IDs need independent resolutions for each version and draft. Approvals from portable exports cannot be reused for stored versions. The stage map shapes are described below. Review complete graphs and external consumers; a proposal hash does not prove equivalent behavior.

Pending and invalid issues can coexist. Ordinary subloop references to retired template loops are invalid and must be replaced. Correct invalid source using the old build or a separately reviewed repair; supply every required review resolution. No candidate escapes while either kind remains. Earlier-stage resolutions can reveal later review items. Reinspect with resolutions until invalid items, pending items and blockers are all zero:

```powershell
pnpm.cmd graphgoblin-upgrade inspect --data-dir C:/GraphGoblin/data --db-url file:C:/GraphGoblin/data/graphgoblin.db --resolutions C:/GraphGoblin/upgrade/resolutions.json --out C:/GraphGoblin/upgrade/resolved-inspect.json
```

Malformed, stale, conflicting and unused resolutions are refused. `disarm` lists both definition nodes and schedule rows, so one trigger may have several entries.

## Apply with a complete verified backup

Use `planHash` from the final resolved inspection. Choose a **new** backup directory whose parent already exists, outside the data tree and separate from the database. Omit `--resolutions` if no items needed review.

```powershell
pnpm.cmd graphgoblin-upgrade apply --data-dir C:/GraphGoblin/data --db-url file:C:/GraphGoblin/data/graphgoblin.db --plan-hash PASTE_FINAL_PLAN_HASH --resolutions C:/GraphGoblin/upgrade/resolutions.json --backup-dir C:/GraphGoblin/backups/before-format-4
```

Apply takes the same stopped-data lock and rechecks the plan. Before opening a writer it copies the whole data tree to `<backup-dir>/data`, including encrypted secrets, key material and artifacts, and verifies hashes against the source. An external database and its WAL/SHM are copied to `<backup-dir>/database`, `database-wal` and `database-shm` when present. `backup.json` records identities and file hashes. The result and failure messages report `backupDir`/the backup path. Missing or corrupt backup evidence, overlap, reused destinations, linked data roots/database paths and changed sources refuse apply. Ordinary non-database links are copied as links; external targets are not snapshotted. Preserve required external content separately. Artifact roots must be physical directories; cleanup unlinks nested links without following their targets.

Under one SQLite write transaction apply rechecks the database plan and blockers, deletes all history and template-owned definitions, removes any old database archive, applies structural SQL through 0013, rewrites definitions/defaults, disables schedule rows, stamps format 4 complete, and verifies readiness, head structure, ledger and integrity. A transaction failure rolls back deletions, DDL, ledger, definitions and marker together. Draft tokens and config hashes derive from rewritten definitions; no old token is retained.

After commit, apply deletes the inventoried artifact files and reads back the store and artifact set. Empty artifact directories may remain. A filesystem/connection failure **after commit cannot roll SQLite back**: the failure says the database committed and reports the recovery backup. Preserve that copy and restore the complete backup before retrying if cleanup/readback did not finish. Do not treat a marker or a failed command as proof of a complete cutover.

## Start and check the new build

Keep the old service stopped, use the upgraded paths, and start the newly built backend/web together. For a foreground source installation:

```powershell
$env:GG_DATA_DIR = 'C:/GraphGoblin/data'
$env:GG_DB_URL = 'file:C:/GraphGoblin/data/graphgoblin.db'
pnpm.cmd start
```

The ordinary readiness check now passes. Review published definitions and drafts, reload server drafts to obtain new tokens, and deliberately re-arm cron/poll triggers only after accounting for lost dedupe/catch-up history. Webhooks remain armed and can receive new deliveries on startup. If using older environment defaults, replace `GG_DEFAULT_MODEL`/`GG_DEFAULT_EFFORT` with `GG_DEFAULTS`, for example `{"byHarness":{"codex":{"model":"gpt-6-luna","effort":"low"}}}`.

## Restore

Restoration discards every edit and run created since the backup. Stop the new build and its restart service. Preserve the failed upgrade directory for diagnosis. Copy the complete `<backup-dir>/data` tree into a **separate recovery directory**, preserving links and encryption material; for an external database copy `database` and every recorded sidecar to the intended external recovery database path. Verify the copy against `backup.json`. Point the **old build** at those recovered paths and start it only after the complete copy is restored. Never run the old build against the converted database or mix restored base/WAL files with newer sidecars. Settle blockers or correct resolutions, stop again, inspect afresh, then use another new backup directory for re-upgrade.

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
`notices` and `reviewItems`. Each issue has `kind: "pending"` or `kind: "invalid"`;
a report can contain both. Items list stable `id`, SHA-256 `hash`, source `path`,
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

API import converts old exports automatically when no review is pending and returns
automatic rewrite `notices` alongside validation `issues` in its `201` response.
The web import result shows these changes. Pending review returns `400 LOOP_FORMAT_UPGRADE_REQUIRED` with `errors.issues` and
`errors.reviewItems`, including IDs, hashes and reasons. API-supplied resolutions
are unsupported; use `--resolutions resolutions.json` with the `v3` map described
above and import the completed format-4 output. Invalid old source or envelopes
return `LOOP_IMPORT_SOURCE_INVALID` instead of a pending-review code.
Mixed refusals retain both issue kinds and explain both correction and review.
The MCP server has no import tool.

## Browser drafts and converter lifetime

Opening the editor archives and reads back the exact original before replacing an
active or set-aside key with its converted definition. A synced mirror remains a
clean cache and the server copy wins; opening it causes no conflict. Unsynced work
stays unsynced. Older unsynced work is set aside when the server is newer, and
restoring it is an explicit overwrite choice.

Old server tokens are invalidated. Saving converted edits requires **Reload server
draft** or **Overwrite with this copy** using a fresh token; the conflict notice
explains the format conversion. This also protects edits made from a converted
synced cache while offline.

If the conversion code cannot load, the notice offers **Retry conversion** or a
page reload. All device copies stay unchanged, editing and autosave pause, and
opening the editor again retries the conversion.

Pending, incomplete or failed old conversions remain inert raw copies with review
issues and **Export original device copy**. Archived originals stay inert and are labelled without reconversion. Failed
archival or readback blocks overwriting autosave. Incomplete current drafts still
reopen for editing. The IndexedDB drafts store is preserved across version upgrades. A raw device-copy
export includes its metadata and tokens; keep that original file and copy its
`definition` field into a separate input file for the offline export command.

The session-storage run-event cache and SSE cursor use the current format in their
key; old keys are removed, forcing a fresh replay. There is no old-event reader.
API responses are not cached by the service worker; React Query state is in memory.

This converter remains available through the cutover release. It can be retired no earlier than the next incompatible release with an upgrade notice. Old exports after retirement require the appropriate older converter/build; runtime parsing does not keep a legacy decision executor.

## Verify the offline workflow

After the API build, `pnpm.cmd test:upgrade` uses disposable fixtures for export, read-only inspection, review/refusal, locking, verified internal/external backups (including committed WAL), apply, ordinary startup migration admission, restoration and re-upgrade. It starts no server and touches no installed instance. The old `inventory`, manifest and in-database `audit` commands are removed; use `inspect`, per-version `--resolutions`, `--plan-hash` and the external verified backup.
