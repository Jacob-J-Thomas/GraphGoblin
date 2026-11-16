# #436 corrected hosted installer candidate

This packet preserves the corrected hosted #436 installer matrix and composed rollback evidence for run 43823828028, attempt 1. Root accepted the scoped corrected hosted engineering QA. Final current-head CI, formal reviews, and merge remain pending. This packet does not claim browser-created PWA provenance, owner UI acceptance, or physical interruption recovery.

## Matrix and rollback result

The x64 STA PowerShell 7 matrix passed all 32 cases: four supported routes and all 28 refusal cases. Case 06 returned the required Node 22.22.2 and `-NodePath` guidance; it did not reproduce the first candidate's strict-mode `.Source` error. All invalid requests were nonzero, before/after snapshots preserved file bytes and native properties, and no listener was present after the cases.

The bounded trace recorded 49 direct calls and 399 matched driver-rooted lifetimes, with zero ambiguous lives, zero ETW event, log-buffer, or real-time-buffer loss, and no observed Chrome or gateway Node main starts during the matrix interval. The first offline pairing output reported 396 lives because PID and process-key reuse widened its match window. That initial result and the exact reused histories remain preserved. Birth-bounded re-pairing resolved the discrepancy to 399; the lifetime verifier was independently rerun against the retained XML. No new native trace was recorded.

The separate rollback witness used actual Windows PowerShell 5.1 and the composed production publisher. Three replacements completed before a real `File.Replace` sharing failure (`0x80070020`). Production restored the prior state; all six old/restored binaries and native link metadata matched, and the lock was disposed. This proves the composed publisher sequence, not a timed interruption of the public installer. The process-start trace covered the matrix interval, not rollback.

## Evidence and preserved qualifications

- [Byte-exact full QA report](full-report.md.txt), [case outcomes](case-readback.tsv), [binary and argv checks](binary-argv-readback.json), [original independent trace readback](independent-readback.json), [first 396-lifetime discrepancy](key-end-first-discrepancy.json), and [corrected lifetime and direct-exit proof](lifetimes-readback.json).
- [Ordered rollback readback](rollback-readback.json), [execution disposition](execution-disposition.json), [exact checkout and merge](checkout-merge.json), and [Git carrier readback](git-carrier-readback.json).
- [Matrix ZIP](artifact/artifact-14206620250.zip), 1,654,443 bytes, 898 members, SHA-256 `909dc86147effb494a69d819f43e9e2c0ebb4317da2867a87e5f0d4c3a689a8c`; [complete member inventory](artifact-member-inventory.json).
- [Rollback ZIP](rollback-artifact/artifact-14205449836.zip), 188,204 bytes, 64 members, SHA-256 `8c6453f333b77e6b93ebee681a4fb24cab118f9b5089f32b03f895e796172db9`; [complete member inventory](rollback-artifact-member-inventory.json).
- [Decoded Windows job log](windows-job.decoded.log), [Windows job metadata](windows-job.json), [run snapshot](actions-attempt1.json), [job snapshot](attempt1-jobs.json), and [artifact metadata](artifact-14206620250-metadata.json) / [rollback artifact metadata](artifact-14205449836-metadata.json).

The first offline lifetime discrepancy is preserved alongside the corrected result rather than replaced. The ETW XML retains PartitionInfo header-extension decode error 15005; classic process records and both canaries decoded. The matrix used actual PowerShell 7; the ordinary 18-test Windows suite includes an actual Windows PowerShell 5.1 installer regression, and the separate public seed also used Windows PowerShell 5.1. The rollback mutation/failure/restoration was a composed publisher test. The Chrome proxy used a real image with a synthetic profile and prepared native Shell Link; browser-created PWA provenance was outside scope. Physical interruption recovery was not exercised.

A console-only Python preview could not render a Greek path under its code page. The case TSV and disposition JSON had already been saved and were read back directly. This was a display limitation; no retry or product change followed it.

## Source binding and acceptance boundary

The tested product, synthetic merge, ordered parents, tree, frozen candidate blobs, and workflow-only carrier difference are recorded in [checkout-merge.json](checkout-merge.json), [Git carrier readback](git-carrier-readback.json), and the [root acceptance receipt](provenance/436-corrected-hosted-root-acceptance.json). The receipt records run 43823828028, Windows job 133152816074, both artifact IDs and digests, all 996 source-seal rows, and root verification of all 962 ZIP members. It accepts scoped corrected hosted engineering QA and requires restored ordinary workflow, final current-head CI, an actual Opus review, and a fresh Astra max audit before merge. Formal scans consumed: zero.

The original [996-row source seal](source-SHA256SUMS.txt) and complete artifact inventories are retained. The two ZIPs and inventories represent all 962 archive members; the 962 extracted member copies are not duplicated. Three connector-response wrappers and the archive extraction helper are omitted as listed in [source-copy-map.json](source-copy-map.json). The original report is preserved byte-for-byte; its source-relative links retain their source context. Use the packet-local links above for this curated copy.

The earlier [first-candidate failure packet](../2026-11-16-installer-validation-candidate-first-failure/README.md) remains part of the history: the corrected matrix does not erase that first failure. [SHA256SUMS.txt](SHA256SUMS.txt) seals every retained packet file except itself.
