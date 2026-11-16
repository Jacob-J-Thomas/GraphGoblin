# PR500 core candidate behavior QA archive

This external archive preserves the first two candidate core behavior QA executions, frozen harness/source provenance, the root-approved cleanup continuation, and the precise limits of the evidence. Source bytes are copied unchanged; original Markdown reports use `.md.txt` filenames so later repository formatting rules cannot rewrite them.

## What the executions show

- Attempt 1 did not reach product behavior. The worker stopped at a harness API mismatch (`native.runPowerShell is not a function`); its exit 1 and report are retained as a harness failure, not a product regression.
- Attempt 2 ran the V4 core behavior stages against the frozen candidate. All behavior stages completed, but the runner and wrapper exited 1 because cleanup inventory refused the WinINet `Content.IE5` junction. The driver's later PowerShell no-reparse/SQLite exclusive-open probe and `disposableRetained` marker were not reached. That original result is preserved unchanged.
- A separate root-reviewed cleanup continuation later removed only the exact owned junction and verified the retained fixture state. This continuation does not change the original attempt's exit or turn its missing driver probe into a pass.
- Attempt 2 observed 3 log rotations over 34,048 requests, a held Script run that succeeded, four exact gateway drains, safe bounded sampled records, and 50 recorded PIDs absent after exit. These are bounded native observations, not full acceptance.

## Evidence and limits

`source-copy-map.json` maps each copied file to its immutable batch source and records byte length and SHA-256. `SHA256SUMS.txt` seals every packet file other than itself. The 395 attempt-2 evidence members, 6 outer invocation receipts, and 6 wrapper receipts are included exactly as named by the worker's evidence inventory. Test-process stdout/stderr files inside that inventory are evidence; private provider event/result/stderr/session files are excluded.

The complete candidate source/build binding (`launcher-438-candidate-binding-01.json`, 4,580,756 bytes, SHA-256 `8202421f8a0bda13d2f46467af88a060539b75111e9fabbbc38f461fcc7cf7ff`) remains retained in the batch and is listed in `exclusions.json`, rather than duplicated here. No fixture database, WAL/SHM, `master.key`, or disposable store bytes are copied. The owner installation and store were unchanged, ports 4747/4748 were not used, and the separately admitted cleanup affected only the exact fixture junction.

The report is behavior QA, not a formal review or verdict. Formal scans were 0/3 at that checkpoint. Controlled production-seam rows, supplemental native rows, current-head CI, independent QA closure, opposite-family review, and a final Astra review remained open. This archive does not claim PR acceptance, merge, or issue completion.

## Inspection entrypoints

- [Attempt 1 report](attempt-1/full-report.md.txt) and [attempt 2 report](attempt-2/worker/full-report.md.txt).
- Attempt 2 [runner result](attempt-2/evidence/result.json), [cleanup assertion](attempt-2/evidence/cleanup.json), and [closing binding](attempt-2/evidence/closing-binding.json).
- The separate cleanup continuation is recorded in [its script](cleanup/root-continuation/continue.ps1) and [receipt](cleanup/root-continuation/continuation-receipt.jsonl).
- Frozen V3/V4 harness sources are under [harness/v3](harness/v3/) and [harness/v4](harness/v4/); the [copy map](source-copy-map.json) and [checksum list](SHA256SUMS.txt) locate and verify every archived file.
