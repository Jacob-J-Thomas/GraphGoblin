# PR #482 merged completion and evidence

PR #482 merged as [15ce9a1dd12e87b7f7cb5f853aaecf68d6188afd](https://github.com/Jacob-J-Thomas/GraphGoblin/commit/15ce9a1dd12e87b7f7cb5f853aaecf68d6188afd), tree **57541f0423de585307f5d7db27923ddac41d7181**, with parents **177f3a7d57768c88f19c6bb4d8ef2b272c1e91bd** (main) and **e1237593babd4d03466b91685fc05dbe49223b2a** (PR head), in that order. The exact merge verification is preserved in [merge-verification.json](source-receipts/merge-verification.json).

This packet preserves the independent final audit, corrected current-head CI evidence, merge and publication readbacks, and issue-state correction. It does not claim owner product acceptance: issue [#208](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/208) is open and parked pending owner review.

## Evidence

- [Corrected publication-head CI packet](../2026-11-15-space-cards-corrected-ci/README.md) — CI run 43698926003 and routing run 43698925969, both successful on attempt 1; no reruns. The packet includes five complete job logs and the exact tested synthetic merge checkout.
- [Original publication-head CI packet](../2026-11-15-space-cards-current-ci/README.md) — retained original failed evidence and qualifications.
- [Final independent Astra scan report](audit-artifacts/report.md.txt) — formal scan 2 of 3; it found no remaining blocker and signed off this exact PR head. The sealed source inventory and all 68 listed artifacts are preserved in audit-artifacts/. Markdown sources use .md.txt filenames only. See [source-copy-map.json](source-copy-map.json) for every original path, destination and verified digest.
- [Published full-report comment](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/482#issuecomment-6892947230) — the exact GitHub response is retained in [final-publication-readback.json](source-receipts/final-publication-readback.json). The root-authored comment body is separately preserved as [root-publication-comment.md.txt](audit-artifacts/root-publication-comment.md.txt); it is separate from the sealed Astra source report.
- [Corrected CI root readback](source-receipts/corrected-ci-root-readback.json) — records acceptance of the external CI packet and its verified log inventory.

The corrected CI run reports 13 package coverage groups with 9,567 passed, 41 skipped and zero failed tests; all package coverage floors passed. Web coverage was 98.60% lines and 94.31% branches across 2,911 tests in 224 files. Gates completed 22 tasks, including nine cached build dependencies. Browser completed 481 tests with one declared live-provider skip. Windows launcher completed 14 tests, but no native-evidence artifact was uploaded. All four templates loaded. Routing thresholds passed with strict mode off; measured frame p95 was 33.4–50 ms, above the optional 17 ms target, so this evidence makes no 60 Hz claim. The CI packet contains the exact job and step qualifications.

## Native and delivery qualifications

The corrected native evidence contains 32 definition-equivalent request/acknowledgement pairs. One Add Script request used the three declared schema defaults (cwd: workspace, stdin: thread, stdout: last-output); it was not a geometry mutation, and not every request/acknowledgement pair was byte-identical JSON. Across the 1,692 prior native input bindings, 1,691 directly match; the sole difference is the delivery register.

The corrected D1 native Undo was captured after the fit completed. It does not demonstrate Undo injected during the precommit readiness gap; precommit cancellation is covered separately by the retained real-dependency readiness and supersession tests and source trace. The original native Edge was 157.0.4341.46; the corrected native run used Edge 157.0.4341.60. Original failures and fixture stops remain preserved. The recovered detailed worker report was reconstructed from retained Write/Edit events without an independently retained original digest, so it is not byte-certified. Strict routing mode remains off, and there is no controlled frame baseline.

## Issue tracking correction

At merge, GitHub automatically closed #208 because the PR body contained a negated sentence that still matched a closing keyword. The historical closed snapshot is retained in [owner-acceptance-state-restored.json](source-receipts/owner-acceptance-state-restored.json), alongside the restored readback: the issue is now open and parked, and ownerAcceptance is false. Root removed the closing phrase, reopened the issue and verified the restored state. This automated transition was not owner acceptance.

## Inventory

[SHA256SUMS](SHA256SUMS) covers every file in this completion packet except the manifest itself. [source-copy-map.json](source-copy-map.json) records the exact provenance and digest of the 68 sealed audit artifacts, the corrected CI copy, and the separate source receipts. [audit-source-SHA256SUMS.txt](source-receipts/audit-source-SHA256SUMS.txt) retains the source audit packet's original inventory.
