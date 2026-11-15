# Issue #410 terminal-wait baseline

This packet preserves two admitted native baseline attempts for issue #410 on merged `main` commit `154401c7b47c1e56b62a6daec50e2a3145ea967d` (tree `7e611f71ac8b3693d574b8f08869d68fed19af4b`). Both describe the behavior before an implementation fix. The second run completed the W1–W4 matrix, reproducing the stale-wait defect in W1 and W2 while exercising W3 controls and W4 historical reopening; it is diagnostic evidence, not a passing product fix or an owner-acceptance result.

## Baseline 01 — incomplete, failure retained

The native fixture reproduced W1’s stale terminal parent wait and completed W3’s live controls. It stopped during historical seed preparation after the gateway shut down: the standalone-file guard found SQLite WAL/SHM sidecars and raised `ERR_ASSERTION` before any copy or unlink. W2 interruption and W4 historical reopen were not reached. The [baseline-01 report](baseline-01/report.md.txt) and raw [first failure](baseline-01/raw/first-failure.json), [summary](baseline-01/raw/summary.json), [runner](baseline-01/raw/runner.json), and launcher receipts are preserved.

The initial launcher invocation used a forward-slash admission path and was refused before the Node probe or supervisor spawn. Root then authorized the canonical-backslash invocation; that native run is the incomplete attempt described above. Both invocation outcomes are retained.

## Baseline 02 — complete old-behavior reproduction

All W1–W4 baseline assertions completed under Node v22.23.4 on the same main tree. W1 reproduced the stale wait after a child’s live script failure. W2 reproduced it after recovery consumed an already-committed `run.failed` event: a composed repository-port gate withheld delegation, then the exact gated process was interrupted and the same store reopened through ordinary compiled startup. The parent kept its old wait. [Pre-interruption](baseline-02/raw/W2-verified-before-interruption.json) and [post-crash](baseline-02/raw/W2-post-crash-before-reopen.json) receipts preserve the gate and restart readback. W3 retained the active-wait, success, cancellation, and authored-exit controls. W4 reopened a separate copy and preserved the captured terminal parent and child rows/events, including the stale wait. See the [baseline-02 report](baseline-02/report.md.txt), [accepted harness summary](baseline-02/raw/summary.json), and [root acceptance](provenance/root/runtime-410-baseline-acceptance.json).

The baseline-02 seed-preparation correction used a fresh staging copy of the complete closed attempt-02 DB/WAL/SHM bundle; input and staging hashes matched. A bounded helper checkpointed only that copy to a standalone database and verified the exact witnessed parent/child rows and events. The original attempt-01 store was not opened or modified; product source, fixture oracles, and timeouts did not change. The [seed-correction receipt](preparation/seed-correction/preparation.json), [root admission](provenance/root/runtime-410-seed-correction-root-admission.json), [bounded helper](preparation/native-revised/owned-store.mjs), and [raw helper comparison](baseline-02/raw/summary.json) preserve that chain.

The first offline comparison was too broad: it compared all active-pair output including list pages for other runs that had progressed. Root retained the [failed verifier record](provenance/root/runtime-410-baseline-root-first-verifier-failure.json) and corrected the comparison to use exact active parent/child raw rows and events. The [corrected offline readback](provenance/root/runtime-410-baseline-root-offline-readback.json) passed; no native rerun followed. This is an offline verifier correction, not a changed baseline result.

## Build and process qualifications

The admitted build ran `pnpm.cmd build --force` on project Node `v22.23.4` and exited 0. Its receipts record the same `main` commit/tree, 28,329 source files, 1,231 outputs across 13 roots, 17 selected dependency files, and 22 workspace links. The 4,293,614-byte full binding remains outside this packet at `runtime-410-build-baseline-review-01/build-binding.json` (SHA-256 `121b25eae6c8784313649af2e057569d86bdee60edb3aae77cf8c90639066ac3`). The smaller build receipt, launch/exit/log, admissions, refusal, and root readbacks are included.

Final cleanup read back 16 recorded numeric PID slots: 15 were absent. The remaining numeric ID, helper PID 53056, belonged to a later Chrome process with a different creation time and was left untouched. All owned processes had exited, all four tested ports refused TCP, and no writer, MCP session, or observer remained.

## Packet contents and exclusions

- Baseline 01 and 02 reports, raw JSON summaries/runners/failures, W2 receipts, launcher logs, build evidence, and root admissions/readbacks are mapped in [source-copy-map.json](source-copy-map.json).
- Raw Markdown reports and preparation notes are named `.md.txt` so their bytes are unchanged. Original source checksum files and report inventories are retained as context; their source paths may refer to files omitted here.
- No SQLite database, WAL/SHM sidecar, script marker, private seed, build output, or dependency directory is copied. The original inventories preserve path/hash metadata for excluded store files. The large full build binding is retained externally and identified by path, byte count, and digest in the source-copy map.
- [SHA256SUMS](SHA256SUMS) covers every packet file except itself.

This packet makes no claim that the implementation fixed the defect, that a candidate passed CI or formal review, or that issue #410 or the broader AIDLC batch is complete.
