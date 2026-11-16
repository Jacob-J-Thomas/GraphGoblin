# #419 history-disconnect baseline evidence

This packet archives the accepted pre-fix baseline for #419. The independent native run reproduced the existing extra-history-replay behavior after an actual response close and completed its controls and cleanup. It establishes the defect on the integrated #410 baseline; it does not establish candidate correctness.

## Baseline identity and acceptance

- The bound build and native run used main `98692c8a8c7b519e8c83e585e026d595cedc0550`, tree `9439a500040aa4763613549cca6235023916de58`. The build receipt, native preflight, launch receipts, and root readbacks bind this baseline. Source/build bindings describe that historical snapshot; this packet does not compare their absolute checkout paths with the mutable implementation checkout.
- The forced baseline build exited 0. Turbo reported 12 successful tasks and zero cache hits. The full [build binding](build-baseline/build-binding.json) is retained once; the [root build readback](provenance/runtime-419-baseline-build-root-readback.json) summarizes and verifies its inventories without duplicating its per-file lists.
- The [native runner summary](native-harness/evidence-baseline-first/summary.json) is 286,770 bytes, SHA-256 `935f6a4abce16e9633f7342fb35d4bc1ca7e73f8b5c1f0c2f9defae1f989ca3c`. Root accepted the baseline result in the [baseline acceptance receipt](provenance/runtime-419-baseline-acceptance.json).
- The [independent baseline report](independent-report/report.md.txt) is 8,589 bytes, SHA-256 `4646abd8e52344620ff532c79687f8f5930a35ebb09420dc8072afeef252632a`. Its six-payload seal is preserved in [SHA256SUMS.txt](independent-report/SHA256SUMS.txt), SHA-256 `3ca865230ed4b0c5e8bdaf0400a0e04460d06ad386f1d6266d83447994214f55`; the root report-acceptance receipt records all six verified rows and 38 immutable external references. It also classifies 32 absolute baseline snapshot paths as historical; those paths were not rechecked against the mutable implementation checkout.

## Observed behavior and evidence tier

The harness exercised compiled production routes composed through Fastify over actual TCP, with the real manager, API-key path, repositories, and file SQLite. It used controlled promise gates and synthetic history appended to four ordinary completed runs. The repository delegate had returned while the route still awaited the wrapped promise. The result is limited to later reads and route work after response close; it does not establish ordinary gateway startup or browser behavior.

- Eight actual TCP disconnect cases targeted sequence 693. Seven non-rejection paths continued after the client socket closed and attempted to write/end the 200 response after close. Those paths issued 6, 6, 6, 4, 4, 4, and 5 extra data-page requests. The held repository promise in the eighth case rejected; the route attempted its existing generic 500 response after close and logged the synthetic repository error.
- Eleven positive connected requests returned 200 JSON and matched the full-history oracle. Ten negative controls covered authentication/query rejection, ownership and missing-run checks, malformed stored data, and a controlled repository fault. The report gives the exact per-case results.
- Baseline evidence includes real response-close observations (`writableFinished=false`, destroyed socket), request ordering, page ranges/counts, response bodies, listener snapshots, and SQLite row digests. The observed post-close work reproduces the defect; the controls and cleanup passed.
- The actual native runner was PID 53076 on Node v22.23.4, exited 0 without deadline expiry, and both stdout and stderr closed with zero bytes. Fastify/container close, socket/listener cleanup, a separate exclusive-open helper, empty owned store, and independent post-run PID/TCP checks are preserved in the raw receipts.

## Included artifacts

- `native-harness/` contains the four sealed harness payloads and their original manifest, plus the baseline `runner.json` and `summary.json` outputs. It contains no database or store.
- `execution-preparation/` contains the ten sealed preparation files and original manifest. Files named `*.example.json` are inert future-admission templates; they are not actual executed admissions. The actual baseline build/native admissions and executions are in `provenance/`, `build-baseline/`, and `native-launch/`.
- `shared-410/` includes only the two shared #410 helpers imported by #419 preparation code. The [execution-preparation root readback](provenance/runtime-419-execution-preparation-root-readback.json) verifies their pinned hashes and the preparation manifest.
- `build-baseline/` retains the baseline build admission, launch, exit, receipt, log, and the single full binding. `native-launch/` retains preflight, launch, actual child exit/close, result, and the captured empty stdout/stderr logs.
- `independent-report/` includes the raw report, verifier, six sealed payloads, and original six-row manifest. The [root report acceptance](provenance/runtime-419-baseline-report-root-acceptance.json) confirms that the report and seal were fully read and accepted.
- The raw preparation and report Markdown files are preserved as `.md.txt`; the original manifests retain their source filenames. [source-copy-map.json](source-copy-map.json) records the original paths and byte hashes. [SHA256SUMS.txt](SHA256SUMS.txt) covers this packet other than itself.

No database, WAL/SHM sidecar, private seed, or secret is included. No current implementation source hash was recaptured: the recorded build and harness bindings are time-bound baseline evidence. A later candidate run is required to assess whether the defect is fixed.
