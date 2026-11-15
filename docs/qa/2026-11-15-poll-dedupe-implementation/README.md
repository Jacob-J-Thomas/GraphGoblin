# Poll dedupe implementation evidence

**Implementation evidence packet complete; corrected native QA remains in progress.** This packet documents the frozen twelve-path source candidate, its local API gates, the separate Windows SQLite cleanup prerequisite, and the preserved intermediate failures. It does not claim that corrected behavior has passed native scheduler/restart QA or that the full delivery is complete.

## Source and build provenance

The candidate was frozen as commit `420240cad27d3865988dc7009dc9d80291e93c9c`, tree `75d6720f6cc7da85e04d9f17f8b96f40b94c4094`, parent `15ce9a1dd12e87b7f7cb5f853aaecf68d6188afd`. The commit contains twelve source, test, and documentation files and no evidence files; the freeze receipt verifies all twelve Git blobs. The original [twelve-file SHA-256 manifest](implementation-12-14/final-source-SHA256SUMS) records the committed source hashes.

The final API coverage and build commands ran before the freeze commit, against the twelve matching source files at parent HEAD `15ce9a1dd12e87b7f7cb5f853aaecf68d6188afd`. The root's [build/source rebind receipt](root-readbacks/runtime-361-source-build-rebind.json) verifies those exact source bytes against the frozen commit and rechecks seven complete compiled-output inventories plus selected output hashes. It explicitly does not claim a build rerun at the frozen commit SHA.

The original source manifest used standard two-space checksum delimiters. The source-freeze helper rejected that syntax before changing the index, which was rechecked empty. The [normalization receipt](root-readbacks/runtime-361-source-manifest-normalization.json) records the delimiter-only derived copy; the [original manifest](implementation-12-14/final-source-SHA256SUMS) and [normalized manifest](root-readbacks/runtime-361-source-for-freeze-normalized-SHA256SUMS) are retained. The final freeze receipt records twelve verified blobs and zero evidence bytes. The [root gate receipt](root-readbacks/runtime-361-root-local-gates.json), [staging receipt](root-readbacks/runtime-361-source-staged.json), and [commit receipt](root-readbacks/runtime-361-committed-freeze.json) preserve the surrounding chain.

## Final local gates

| Gate                      | Result                                                                                                                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API coverage              | 1,943 passed, 14 skipped; 125 files passed and 2 files skipped. Lines 95.95% (3,844/4,006); branches 90.88% (3,003/3,304); statements 94.61%; functions 92.22%.                                                                                   |
| API test skips            | 8 platform-specific; 2 D-015 dynamic skips because this host confirmed termination instead of sandbox taskkill denial; 3 live-provider smokes; 1 performance baseline.                                                                            |
| Changed API paths         | `poll-items.ts`: 17/17 lines and 16/16 branches; `poll.ts`: 77/77 lines and 64/65 branches.                                                                                                                                                       |
| Domain coverage           | 460 tests in 29 files; 98.73% lines and 96.09% branches.                                                                                                                                                                                          |
| Final static checks       | API typecheck passed all 7 tasks; Prettier passed on all 12 changed paths; `git diff --check` passed. Earlier affected-package lint remains valid for the byte-identical #361 paths; this packet does not claim a fresh full-repository lint run. |
| API build                 | 7 tasks, no Turbo cache hits, 3.862 seconds. Turbo ran with `--force`; the package scripts used their normal TypeScript incremental builds. The final inventory records 1,056 files in 7 output trees.                                            |
| #483 cleanup prerequisite | The two Ollama cleanup specs passed 25 tests with one worker, zero failures and zero skips. This targeted run is separate from native scheduler/restart QA.                                                                                       |

The final API coverage used Node 22.23.4, pnpm 12.8.1, and `--maxWorkers=2`. The fourteen skips are retained as qualifications, not treated as passing executions. [Coverage log](implementation-12-14/12-final-api-coverage.log) and [coverage receipt](implementation-12-14/12-final-api-coverage-receipt.json) bind the command, source inputs, compiled outputs, and totals. The [static log](implementation-12-14/13-final-static.log), [build log](implementation-12-14/14-final-api-build.log), [build receipt](implementation-12-14/14-final-api-build-receipt.json), [final compiled inventory](implementation-12-14/14-final-compiled-inventory.json), and [source/build readback](implementation-12-14/14-final-source-build-receipt.json) retain the other gate evidence.

The first serialization of the final compiled inventory left its derived total blank while preserving the full file arrays and per-tree counts. The corrected inventory and readback recompute the total. Both original intermediate serializations remain in `implementation-12-14/` so the correction is auditable.

## Preserved failures and limits

- Before the #361 implementation, the public-port red run had five intended failures and twenty passing controls. The [red log](implementation-01-11/01-public-ports-red.log) preserves the observed malformed-key lookup/admission behavior.
- The first API package-coverage attempt after the implementation had 1,935 passing tests, 14 skips, 5 failures, one unhandled worker error, and no API V8 aggregate. The later four-file isolation run had 38 passes and 3 failures. These early results and inventories remain in [artifacts 01–11](implementation-01-11/); they are not represented as the final gate result.
- On unchanged merged-main source, the two Ollama cleanup specs reproduced four SQLite `EBUSY` cleanup failures with 21 passing tests. The separate #483 change adds garbage collection before removal in two test cleanup hooks; its targeted [run log](cleanup-483/two-spec-run.log), [receipt](cleanup-483/run-receipt.json), [source readback](cleanup-483/final-source-readback.json), and checksum file preserve that result. The original cleanup evidence remains under `implementation-01-11/`.
- The [native baseline packet](../2026-11-15-poll-dedupe-baseline/README.md) records 21 poll observations and 34 durable IDs across a real scheduler and same-file restart. It is baseline evidence only. Corrected native scheduler, overlap, restart and durable-count verification remains in progress and is not included here.

## Packet inventory

- `implementation-01-11/` — initial red and green runs, first build/static/coverage, diagnostic isolation and unchanged-main cleanup reproduction. The historical pre-diagnosis report is retained as `full-report-before-cleanup-diagnosis.md.txt`.
- `implementation-12-14/` — final coverage, static checks, build, inventory correction, source/build readback, and source manifest.
- `cleanup-483/` — exact two-spec cleanup prerequisite evidence and its original nested checksum manifest.
- `root-readbacks/` — root-authored freeze, local-gate, source rebind and manifest-normalization receipts, plus the normalized delimiter-only checksum manifest.
- [`full-report.md.txt`](full-report.md.txt) — final detailed report, copied byte-for-byte from the released `full-report.md` source. Its SHA-256 is `fce24a205286c52024d452bc2c6332e2d4c50097028ca6db251c071cfe2bc59d`.
- [`source-copy-map.json`](source-copy-map.json) maps each copied artifact to its source-relative path, byte count, SHA-256, and copy/rename treatment. [`SHA256SUMS`](SHA256SUMS) hashes every packet file except itself; it includes the source-copy map and this README.
