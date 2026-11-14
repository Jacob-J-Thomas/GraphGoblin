# PR #470 final audit and CI record

**Final engineering sign-off:** PR #470 was audited at head `8fc8c0a5240c304dfe4f309caad8bd1ebf540948`, tree `af0e9f76b750ecbd308b3e12c589fb729b3ebf23`, against target `7c6e635539e12c56b82f226f1ee734d83b985ad4`. The report is scan 3 of the maximum 3 and found no remaining in-scope blocker. It was published at [review comment 6881200714](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/470#issuecomment-6881200714); the exact raw report is preserved in [report.md.txt](raw/report.md.txt), SHA-256 `1e4ec4b45ca021c465e8087f87acc32cc574c03fd852897ace633a272f53ee32`.

After that review and CI, PR #470 merged at 2026-11-14 17:08:58 UTC as [commit `a817e5ccb4fd598ca56089b97b4ce55e9cb6f58c`](https://github.com/Jacob-J-Thomas/GraphGoblin/commit/a817e5ccb4fd598ca56089b97b4ce55e9cb6f58c), tree `af0e9f76b750ecbd308b3e12c589fb729b3ebf23`, parents target `7c6e635539e12c56b82f226f1ee734d83b985ad4` and reviewed head `8fc8c0a5240c304dfe4f309caad8bd1ebf540948`. The report's pre-merge disclaimer is retained verbatim; this paragraph records the later merge. Engineering sign-off is not owner product acceptance. Owner acceptance for #209 remains open.

## Current CI at the reviewed head

All five current CI jobs passed on their first attempt. The main [CI run 43614498888](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43614498888) passed Gates, Browser, Windows launcher, and Template image. [Routing run 43614498893](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43614498893) passed its routing job. Both runs are bound to head `8fc8c0a5240c304dfe4f309caad8bd1ebf540948`; the exact raw logs are retained below.

| Job                 | Result summary                                                                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gates               | Passed; 22 coverage tasks. Web: 2,491 tests. The configured dependency audit passed its threshold while reporting 8 low and 13 moderate advisories. |
| Browser             | 474 passed, 1 expected provider skip, no retries.                                                                                                   |
| Windows launcher    | 14 passed, no failures or skips.                                                                                                                    |
| Template image      | Passed.                                                                                                                                             |
| Routing performance | 2 checks passed; this is not a physical 60 fps claim.                                                                                               |

The original Windows `EPERM` failure tracked as [#471](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/471) remains unresolved. A clean first-pass run does not establish its cause or close that issue.

## Review disposition and limits

U1 import-selection ownership and U2 explicit retry ownership are fixed in the merged PR. The guide wording is corrected. The report retains their original failures, accepted fixes, evidence tiers, and limits. It also records #472 and #473 as deferred, #237 as separate work, and the Windows #471 diagnostic as open. No physical-device, assistive-technology speech, live-provider, or owner-acceptance claim is made.

## Evidence map

- [Final admission and merge summary](final-admission.json) records the post-review merge identity and retained open dispositions. [Auditor readback](raw/auditor-readback.json) independently binds 577 manifest-listed QA files, 82 non-QA files, and six supplemental legacy QA paths to the audited tree.
- [Gate status](raw/gate-status.json), [final identity readback](raw/final-identity-readback.json), and [source/evidence readback](raw/source-and-evidence-readback.json) preserve final admission, run/job identity, and source/artifact hash bindings. [identity-pre-admission.json](raw/identity-pre-admission.json) is the earlier `PREPARED ONLY` marker; it is historical and superseded by those final readbacks and the report.
- Current raw logs: [Gates](raw/ci8fc-gates-pass.log), [Browser](raw/ci8fc-browser-pass.log), [Windows](raw/ci8fc-windows-pass.log), [Template image](raw/ci8fc-template-pass.log), and [Routing](raw/ci8fc-routing-pass.log).
- The exact reviewed diff is preserved as [exact.diff.gz](raw/exact.diff.gz): the gzip file is 7,729,039 bytes, and decompresses byte-for-byte to 14,791,378 bytes with SHA-256 `d2372898b66f3099a7acfbad969a500dc70526dc7de5930bfdf3e38fe041babc`. The gzip artifact SHA-256 is `41fe06f7f6d2da530247bf0af20ef013d78fc584c5588da53b3de01534aa1459`. From the repository root, recreate the equivalent Git range with `git diff --binary 7c6e635539e12c56b82f226f1ee734d83b985ad4 8fc8c0a5240c304dfe4f309caad8bd1ebf540948 > exact.diff`. Git output may vary with configuration or object context; verify a regenerated file against the recorded size and hash before treating it as the exact reviewed artifact.
- The 577 source QA files were already committed and audited; this packet links to their canonical records instead of copying them: [U1 baseline](../2026-11-14-loop-name-import-order-baseline/README.md), [U2 baseline](../2026-11-14-loop-name-invalid-retry-baseline/README.md), [corrected native QA](../2026-11-14-loop-name-review-correction-independent/README.md), [corrections](../2026-11-14-loop-names-review-corrections/README.md), [implementation](../2026-11-14-loop-names-implementation/README.md), and the [earlier review/CI packet](../2026-11-14-loop-names-review/README.md). Those paths resolve in the merged tree above.

The report, readbacks, and CI logs in `raw/` are byte-preserved. [manifest.json](manifest.json) records source paths, sizes, and SHA-256 values; [SHA256SUMS.txt](SHA256SUMS.txt) covers all packet files except itself. [link-checks.json](link-checks.json) records local and canonical-source link bindings. No raw model streams, private event transports, usage/result records, credentials, store files, or full exact diff are included.
