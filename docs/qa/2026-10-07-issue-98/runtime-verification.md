# Issue 98 runtime and offline-upgrade verification

Scope: approved format-2 decision/defaults cutover, API admission and one-off offline migration. No session-policy changes, no issue-33 implementation, no installed-instance conversion, no Git staging/commit/publication. This records the runtime handoff; the integration record tracks subsequent global gates, Edge E2E and independent review. This report does not claim an Opus approval.

## Commands and results

From `C:\Users\98jak\.codex\worktrees\decision-kinds-98\GraphGoblin`:

- `pnpm.cmd --filter @graphgoblin/api exec vitest run --coverage --reporter=dot`: 353 passed, 2 intentional LIVE skips; statements 97.15%, branches 92.21%, functions 95.35%, lines 98.54%. Focused tests include old-env rejection before SQLite, strict old setting/import refusal, invalid process defaults without file/row writes, authoritative disabled/manual catalog entries, uniform decision/inference admission (root separately verified exit admission afterward), and runtime unavailable selections with no fallback.
- `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run --coverage --reporter=dot`: 181 passed in the recorded overall run; statements 98.44%, branches 91.35%, functions 98.04%, lines 99.35%. The subsequent focused `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/sqlite/upgrade.test.ts --reporter=dot` passed 14/14, including the added failed-subloop-parent disposition case. Root's final overall run will refresh the total.
- `pnpm.cmd --filter @graphgoblin/domain exec vitest run --coverage --reporter=dot`: final 253 passed, including the new subloop scanner; statements 96.80%, branches 93.32%, functions 96.17%, lines 98.14%.
- `pnpm.cmd --filter @graphgoblin/api typecheck`, `pnpm.cmd --filter @graphgoblin/domain typecheck`, `pnpm.cmd --filter @graphgoblin/infrastructure typecheck`: passed at the source handoff checkpoints. No agent tsc/build remains running. Root owns final lint/typecheck after formatting.
- `pnpm.cmd test:upgrade`: after the PR-115 backup-path fix, 11 tests, 9 passed, 2 Windows-only file-symlink permission skips, zero failures, 3.32 seconds against built distribution entry points. All original eight acceptance cases pass. The new portable directory-junction refusal case passes locally; direct file-symlink/sidecar refusal and unrelated-link preservation remain pending Linux CI, where file symlinks do not require Windows privileges.

## Retained disposable CLI evidence

All paths below are ignored synthetic fixtures; none are the user's installed GraphGoblin data.

- `.tmp/upgrade-acceptance-GLeaGN`: internal-store inventory, approved/bad manifests, complete failed/good backups, raw audit, independent restored directory and approved second upgrade. Assertions prove failed transactional conversion rolls back definitions and DDL/marker; complete original backup includes key/configuration and raw histories; restored inventory hash matches the original; second approved upgrade is current.
- `.tmp/upgrade-acceptance-3rsF8s`: real external SQLite base + committed WAL/SHM, backup and separate restored database/data directory. A quiescent writer image is copied to an independent stopped snapshot before upgrade; no writer connection touches the upgraded file. The restored WAL yields the identical source inventory hash, then a second approved conversion succeeds and the hard read-only guard reports current. Original and recovery evidence is retained.
- Other acceptance cases prove native read-only inventory cannot create a missing database or write rows, a held live data-directory lock refuses before database/backup creation, byte-exact external base/WAL/SHM copies, overlap/reused destination refusal, complete old portable bytes retained, explicit mixed-chain owner selection, and unchanged original stable edge ports for the frozen real AIDLC export.

Native Windows SQLite statements can retain closed file handles until GC; test fixtures are deliberately retained rather than recursively deleted while native handles may remain.

## Peer findings resolved

1. Shape-based recursive history conversion mutated arbitrary user JSON. Conversion now targets documented outputs/lastOutput and corresponding patch locations only. Assertions preserve vars, invocation payload and messages that merely resemble decision output.
2. Partial confidence patches on unrelated inference results were falsely refused. Refusal is gated by the known affected decision origin; an inference confidence 0.1-to-0.2 patch is preserved.
3. Recorded migration-only stores were mistaken for fresh empty databases. A nonempty migration ledger without application tables now refuses; a truly empty ledger remains eligible for fresh initialization.
4. A full owner decision replacement could rename option IDs while leaving old edge ports disconnected. Replacement IDs must equal the original route-ID set. Replacing yes/no with ready/revise refuses; reviewed labels/criteria/evaluator changes preserving IDs pass.
5. Exit predicate availability warnings were incorrectly exempted from publication blocking. The path exemption is removed; root added API tests for disabled inherited models and missing harnesses, including successful publication after restoring availability (19 catalog tests passed).
6. Missing harness availability hid explicit unknown/wrong-harness/unsupported-model configuration errors. Catalog resolution now runs despite unavailable harnesses; create/save/import reject malformed authored choices, validation reports them, and availability stays an additional warning.

Additional fixes: actual parsed JSONata/Liquid roots, aliases, dynamic/whole-thread consumers refuse conservatively without treating comments/string literals as references; missing failed-run version references refuse even with no decision event and old initial output; subloop child-return/captured-variable/whole-result consumers require review while proven status/outcome/childRunId metadata access passes; failed parent versions with subloops require individual nonresumable-replay disposition. Historical DECISION_NO_ROUTE, diagnostics/order, original alternatives and unknown provenance remain factual; no probabilities are invented. Full replay and snapshot-plus-tail must equal, sessions remain byte-equivalent.

## Guide boundaries

`docs/guide/08-offline-upgrade.md` matches the command surface. The guide documents that complete decision replacements preserve original option IDs/edge ports (invalid old IDs require a separately reviewed repair), subloop returned values and captured result variables are possible indirect consumers, and affected failed subloop parents require individual disposition. Inventory/audit use a native read-only connection. All changes remain one-off conversion/audit paths; normal parsing and execution accept only the current contracts.

Pending outside this report: root's overall monorepo gates/Edge batch, final formatting and independent adversarial review. Offline tests do not establish a live vendor inference result.

## PR 115 backup-path review fix

Codex finding `discussion_r4210788476` identified a configured database link lexically inside the data directory but physically outside it. The old backup recorded and copied the link rather than independently snapshotting its target. On this Windows host the isolated junction reproduction stopped with `EPERM` when Node attempted to copy the link; no end-to-end source mutation was claimed. Linux file-symlink regression coverage is pending CI.

The offline command now rejects database/base/WAL/SHM files reached through symbolic links or linked ancestors, and rejects linked data roots with guidance to use the physical path. It resolves the backup parent before containment checks, refuses overlap before mkdir, and performs database-path checks before backup creation or mutable SQLite opening. Ordinary unrelated data links retain the existing preserved-link behavior; the guide explicitly says their external contents are not snapshotted. No general filesystem framework or link-dereferencing restore format was added.

Focused assertions cover an internally named DB symlink to an external target, separately linked WAL/SHM, a DB reached through a directory link/junction, a linked data root, a backup parent aliasing the data directory, an existing destination aliasing the external DB parent, original source bytes preserved, and unrelated non-database links preserved. Two file-symlink tests skip only when Windows returns `EPERM` creating the fixture; the directory-junction test runs locally and Linux CI runs every case.

The fresh-checkout CI fixture fix creates the ignored repository `.tmp` parent recursively before each retained mkdtemp in the acceptance helper and version-migration fixture. An isolated missing-parent/existing-parent helper passed both prefixes. After applying both patches once, `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/sqlite/version-migration.test.ts --reporter=dot` passed 2/2 in 3.05 seconds, and Prettier checks passed all four source/guide files. No full coverage run was started for this narrow fix.
