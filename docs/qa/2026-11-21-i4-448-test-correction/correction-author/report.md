# D194 test-only correction: frozen author handoff

Implemented both selected corrections in `apps/api/src/preflight-catalog.test.ts` at base head `cc0a52cffe7e0bffb197c3f3342d370e2b1b9794`. The final scoped suite passes 14/14 tests with zero observed outbound fetch or socket attempts. API typecheck, API lint, scoped Prettier and `git diff --check` pass. No tracked production or documentation file changed. Nothing was staged, committed, pushed, published or archived into the repository.

| Binding | Value |
| --- | --- |
| Worktree | `G:/ggq/gg-i4-448-preflight/GraphGoblin` |
| Original test SHA-256 | `14b1532ec5bbf1d3257883c1ef57798600840db50a282161ffd07ba3166c4b71` |
| Final test SHA-256 | `a67356cd6773b265df80ced4e26a9c1f17cd0fe0c48f2d4cb286ddc315c611ae` |
| Final Git blob | `a187acae037ae928b67715fe2d83f8cc1538c84f` |
| Source delta | One file; 128 insertions, 5 deletions |
| Runtime | Project-scoped Node `v22.23.4`, first on PATH; `pnpm.cmd` |
| Per-command TEMP/TMP | `G:/ggq/qa-scratch/i4-448-test-correction-01` |

The fixture environment now sets `GG_OLLAMA_ENABLED: 'false'`. Both existing parameterized startup call sites remain: two positive starts and two disabled-default starts, with all catalog assertions retained. The new helper compares database bytes exactly through `Buffer.equals`. An initially existing WAL must remain present and byte-identical, including an empty WAL. An initially absent WAL can remain absent or become exactly empty. No SQLite runtime setting changed.

An AST comparison found 21 original assertion statements. All 17 original assertions outside the four selected storage equalities remain verbatim. Those four equalities now call the selected predicate. The original frozen nonempty-WAL case remains and additionally verifies that its initial WAL is nonempty. See `observations/evidence-summary.json` and `final/change.patch`.

The two added positive cases run real offline preflight against disposable, migrated SQLite databases with a missing shipped Codex seed. Each starts from a checkpointed database copied to a fresh path, so no earlier SQLite client can create or remove the target's sidecars. One explicitly verifies WAL absence before the first reader; the other verifies an existing empty WAL. Both check successful readiness, unchanged stored catalog rows, unchanged migration rows and the selected storage predicate before and after the independent read-only inspections.

The negative-control case changes real disposable files and uses a real SQLite writer to generate frames. It proves rejection of changed database bytes, removal of an existing empty WAL, frames against an initially absent or empty WAL, mutation or removal of an existing nonempty WAL, and truncation of a nonempty WAL to empty. The real writer leaves checkpointed database bytes fixed while adding an 8,272-byte WAL with two 4,096-byte frames. The original frozen preflight WAL control also retained its 8,272 bytes exactly. These are genuine SQLite/storage controls in addition to direct predicate rejection checks.

The final observer retained 44 directory listings and 81 database/WAL byte reads across 15 directories. Fourteen unique byte blobs across all retained runs were saved under `fixtures/blobs`; every filename was reverified against its SHA-256. These include original and deliberately changed database/WAL bytes. The final absent-WAL case is `gg-preflight-catalog-2U5A69`, with no target WAL in its initial listing; preflight then creates a zero-byte WAL. Its database stays `c749672cfd9f71ccf8903f7db0c705c4670525a43cccf83e6bb5032a3b8c1ca7`. The existing-empty case is `gg-preflight-catalog-1QdQjx`, with the same unchanged database bytes and an empty WAL throughout. Raw listings and hashes, including mutation differences, are in `commands/08-final-single-file.observer.jsonl` and `observations/evidence-summary.json`.

| Retained command | Outcome |
| --- | --- |
| `01-observer-selfcheck` | PASS: deliberately requested one fetch and one socket connection; both blocked before access |
| `02-strict-counterfactual` | INCONCLUSIVE: initial fixture preparation raced native WAL cleanup and raised ENOENT before the predicate ran |
| `03-strict-counterfactual-valid` | EXPECTED FAIL: one selected absent-WAL case reaches strict map equality and rejects only the newly created empty WAL |
| `04-corrected-single-file` | PASS: 14/14; initial deep-buffer helper, 98.71 s total; negative case 19.713 s |
| `05-api-typecheck`, `06-api-lint`, `07-format-check` | PASS for that candidate |
| `08-final-single-file` | PASS: 14/14, 13.30 s total; negative case 2.384 s; zero outbound attempts |
| `09-final-api-typecheck`, `10-final-api-lint`, `11-final-format-check` | PASS for final source |
| `12-final-diff-check` | PASS |
| `13-evidence-verification` | FAIL in external evidence script: it incorrectly required Vitest's worker to emit an exit callback record |
| `14-evidence-verification-corrected-metadata` | PASS: source preservation, protected-file hashes, byte blobs, scope and observer attempts verified |

Every command has separate stdout, stderr, observer log and JSON receipt under `commands/`. Receipts bind source hashes before and after each command. The sole valid old-versus-new comparison is command 03 against the corrected candidate and final command 08. Source comparison verifies that the strict counterfactual and final file differ only inside `expectStoreUnchanged`; all fixture and scenario bytes are identical. The strict predicate fails at its equality assertion after real preflight creates an empty WAL. The source was restored byte-for-byte in a `finally` block after each counterfactual; both restoration receipts are retained. No failed command was deleted or rerun unchanged to seek a different result.

The failed first counterfactual exposed a flaw in the newly added fixture setup: calling GC and immediately listing/reading the source WAL could race native cleanup. The correction copies the checkpointed database into a fresh pathname rather than waiting, changing SQLite behavior or adding retries. The first corrected suite passed, but its new rejection case approached the unchanged 20-second test timeout. The final helper uses exact native `Buffer.equals` instead of recursive Buffer-object comparison; this preserves the byte predicate and removes costly assertion diffs. The final scoped checks were repeated because that helper changed. No timeout, retry count, coverage threshold or exclusion was changed.

The observer preloads before the ordinary Vitest entry point and its fork. It blocks every fetch and `net.Socket.connect` attempt synchronously and logs each attempt before rejection. Its separate selfcheck establishes that the guard blocks access. Both the ordinary Vitest process and test worker logged installation. Command 08 records no blocked-fetch or blocked-socket event; the parent exit summary reports zero of each. Vitest's worker supplied no exit callback summary, which made external script 13 fail; a separate live PID check confirms that worker had exited. The script correction records missing exit metadata explicitly and verifies the synchronous attempt log without claiming a nonexistent worker summary. No source or observer behavior was changed for this metadata correction. The observer also saves exact SQLite byte reads and directory listings without modifying their results.

Historical P01/P03/P18 evidence was read and copied unchanged into `originals`: absent-to-empty WAL, a byte-identical 16,512-byte WAL, and an existing empty WAL. Their distinct fixture sizes are not presented as results from this author run. The historical ten blocked requests came from three files and are not attributed to this isolated file. The historical broad 61-test command was not repeated.

The starting checkout was clean. Final `git status` contains only the authorized test file, and the Git index remains unchanged. Nine protected source/configuration/documentation hashes match the initial binding. The supplied brief, D194 decision, negative scan-3 report, historical observation originals, original test source, every intermediate candidate and the strict counterfactual variants are retained under `originals`. An initial read-only lookup guessed `sqlite/database.ts`, which does not exist; the actual module is `sqlite/db.ts`. That lookup failure was unrelated to a test or gate.

This is the bounded author handoff. It supplies neither independent Fable corrective review nor independent Opus behavior QA. Full coverage, exact-head/current-target CI, canonical native verification, coordinator completion and owner decisions remain with the root workflow. No fourth general scan was performed. The source and evidence are frozen for that handoff; #448 remains open for owner-only closure.
