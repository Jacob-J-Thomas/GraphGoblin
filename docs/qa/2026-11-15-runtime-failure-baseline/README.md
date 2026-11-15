# Runtime failure baseline evidence (#381 / #414)

This packet preserves the accepted historical baseline for the internal failure handling and native functional cases. It records behavior on source `f91bd69b79dc417a2997ddb9c7670cb33df7597c` (`c5d6d7f505e52b5ccf07b4bcb791777761dc45df`). It does not assert behavior for a corrected candidate.

## Frozen build and source binding

The source build used project Node `v22.23.4` and `pnpm.cmd build --force`; it completed successfully with 12 tasks and zero Turbo cache hits. The build receipt, complete log, launch record, input, and one full source/output binding are in [`build/`](build/). The binding SHA-256 is `aaffb09b4e656487d84a8eadafaaea0843df9eb2427c595f2c4aaa0972a6f9ad`; it covers 27,595 tracked source files, 1,227 outputs, and 13 output trees. The internal and functional admissions and root readbacks bind to this same source and build.

## Functional baseline

The first V3 attempt reproduced the authored mutation failure through REST, SQLite, and stdio MCP. The inspector could not start: Edge automation failed during the first case, before navigation. The driver exited 1, no whole case completed, and the remaining matrix did not run. The first post-exit readback still found the disposable Edge profile, database, WAL, and SHM. Original failure and separate cleanup continuation records remain under [`functional/attempt-1-execution/`](functional/attempt-1-execution/) and [`functional/attempt-1-evidence/`](functional/attempt-1-evidence/).

The later V4 attempt matched all 18 declared A1/A2/A5 behavior observations, including the native and composed cases, real SQLite, controlled structured-port responses, REST/MCP flows, and three inspector readbacks. Its original driver exited 1 because the Windows PowerShell SQLite cleanup helper rejected the path array. A separate cleanup continuation verified exclusive handles for all six database/WAL/SHM files and removed the owned tree; the product was not rerun. The root acceptance records the original exit and its qualification in [`provenance/runtime-381-functional-baseline-root-acceptance.json`](provenance/runtime-381-functional-baseline-root-acceptance.json). The full report, launch/exit receipts, case index, transcripts, screenshots, DOM, network and console records are under [`functional/attempt-2-execution/`](functional/attempt-2-execution/) and [`functional/attempt-2-evidence/`](functional/attempt-2-evidence/).

The separate browser-only probe passed startup/cleanup scope with exit 0. It did not test the inspector itself; that was later covered by the V4 functional attempt. See [`functional/browser-only-probe/`](functional/browser-only-probe/) and its [root disposition](provenance/runtime-381-browser-probe-root-disposition.json).

## Internal A3/A4 baseline

The internal harness retained 13 cases with 13 `assertions-met` results, 13 successful store cleanups, an independent exact-binding check, and a root readback confirming empty stores and 17 absent PID slots. Two native child controls exited and closed with code 7. This tier used a compiled RunManager, physical SQLite, production handlers, and controlled ports or synthetic historical records. It did not exercise REST, MCP, browser, external providers, or a native gateway. The [accepted full report](internal/execution-2/report.md.txt), [case index](internal/execution-2/case-index.json), 13 public/private case pairs, and [root acceptance](provenance/runtime-381-internal-baseline-root-acceptance.json) retain the detailed observations.

The supervisor evidence has two distinct failures. Attempt 1 hit `EEXIST` before harness spawn; the recovered original admitted wrapper is preserved with its exact SHA-256 readback, alongside the mutated wrapper and preflight receipt. Attempt 2 ran the frozen harness and retained its 13 case results, but its wrapper exited 1 while constructing the final receipt after referencing an undeclared `afterExitIdentityError`. The harness-level overall exit was not retained. Root accepted the behavioral baseline and explicitly recorded that no overall zero-exit claim is available. See [`internal/execution-1/`](internal/execution-1/) and [`internal/execution-2/`](internal/execution-2/).

## Provenance and limits

The three functional harness snapshots and their original source manifests are under [`functional/harness/`](functional/harness/); the internal harness and manifest are under [`internal/harness/`](internal/harness/). Raw Markdown reports and JavaScript modules use `.md.txt` and `.mjs.txt` destinations so their copied bytes remain exact. [`source-copy-map.json`](source-copy-map.json) maps every copied item to its batch source path, records byte counts and hashes, and explains those destination names. `SHA256SUMS.txt` inventories packet files except itself.

Temporary profiles, databases, WAL/SHM files, dependency trees, build output directories, and live provider streams are not included. Only one complete 4 MB source/output binding is included; the duplicate internal post-binding capture is omitted, with its independently accepted readback retained. This packet is baseline evidence and provenance. It does not claim a corrected implementation passed, and its retained wrapper/driver exit failures remain part of the record.
