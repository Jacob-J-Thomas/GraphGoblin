# PR #497 and issue #436 completion evidence

This packet records the completed engineering delivery for issue #436. It preserves the final integration readback and Astra scan 2 audit artifacts. It does not claim owner acceptance for the broader launcher batch.

## Final integration

PR #497 merged as `e21c24be9cef109ef438fd2df4c1583bc570b1cb` at 09:29:15 UTC on 2026-11-16. The merge tree `d064706fb48def7bacac5e434f96825c5850d214` matches the reviewed and tested tree. Its ordered parents are target `be633141be5a0cd2b4f960a46761fabbf2cb82c7` and head `2732dd34457bcd9a7007e89c3fa11fe085af764c`. Issue #436 was closed as completed at 09:29:16 UTC.

The [root integration receipt](provenance/436-root-integration.json) binds the merge, tested synthetic merge, final CI, review dispositions and issue closure. A separate [fresh live PR and issue state snapshot](provenance/final-live-state.json) records the terminal connector GETs captured at 09:37:35 UTC; it omits the full bodies and confirms the final completion sections.

## CI and formal reviews

The [final ordinary CI packet](../2026-11-16-installer-validation-final-ci/README.md) records all four jobs passing on run 43829142179, attempt 1: Gates 9,619 passed and 41 skipped across 13 coverage groups; Browser 481 passed with one declared live-provider skip and zero retries; Windows 18/18; and the Template image smoke passed. The Windows upload step found no native artifact. Optional strict browser performance remained off; see the CI packet for all qualifications.

The [Opus scan 1 archive](../2026-11-16-installer-validation-formal-review/README.md) records READY. The [published full report](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/497#issuecomment-6912181315) is comment 6912181315. Astra scan 2 returned SIGN-OFF; its [published full report](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/497#issuecomment-6912573047) is comment 6912573047. The [Astra dispatch receipt](provenance/launcher-436-astra-dispatch-receipt.json) confirms the explicit `gpt-6-astra` / `max` dispatch with `fork_turns: none`; the collaboration API exposed no separate provider-runtime payload. The exact audit report and supporting artifacts are retained under [audit](audit/full-report.md.txt); the audit reports 2 of 3 formal scans consumed.

## Audit record and qualifications

The [Astra report](audit/full-report.md.txt), [inspected-evidence list](audit/inspected-evidence.md.txt), mechanical evidence inventory, scripts, results, and live snapshots are byte-preserved. The original [audit SHA-256 file](audit/SHA256SUMS.txt) is also preserved. Its 23 listed payloads were verified against their source hashes; the copied Markdown report and inspected-evidence filenames use `.md.txt`, with original-to-copy paths recorded in the [source-copy map](source-copy-map.json).

Two retained events were failures of the auditor's offline evidence tooling, not product or native test failures. The initial rollback reader expected `exitCode` inside a stream-close receipt and stopped with `KeyError`; the actual exit code was in a separate receipt, and the corrected offline verification passed. A long PowerShell command exceeded Windows' command-line limit before a process or evidence write was created; the same captured read-only API results were saved through the file patch tool. The [failure receipts](audit/offline-rollback-initial-failure.json) and [write-limit receipt](audit/offline-write-fallback.json) preserve these details.

## Scope and remaining work

This closes engineering issue #436 only. Owner acceptance on #276 and #325 remains separate; PR #460 remains held. Follow-ups #496, #498, and #499 remain parked. Separate #438 work precedes #456 and retains its own gates. No overall batch-completion or owner-acceptance claim is made.

The [source-copy map](source-copy-map.json) records all copied and derived files. The top-level [SHA-256 inventory](SHA256SUMS.txt) covers every packet file except itself.
