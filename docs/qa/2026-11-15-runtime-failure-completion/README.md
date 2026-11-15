# PR #485 completion evidence — runtime failure

This packet preserves the final review and merge evidence for PR #485, covering issue #381 and its related #414 work. The full current-head CI logs and coverage archives remain in the sibling [final CI packet](../2026-11-15-runtime-failure-final-ci/README.md); they are not duplicated here.

## Disposition

PR #485 head `693ea3c9d05359f6ebee8822dd566c99c3e4973c` was reviewed against target `f91bd69b79dc417a2997ddb9c7670cb33df7597c`, then merged to `main` as `154401c7b47c1e56b62a6daec50e2a3145ea967d` at 2026-11-15 19:38:38 UTC. The merge tree `7e611f71ac8b3693d574b8f08869d68fed19af4b` equals both the reviewed publication tree and tested synthetic-merge tree. The root merge readback records the parents and confirms issue #381 is closed as completed.

GPT-6 Astra at max effort issued **SIGN-OFF** in formal scan 2 of 3. The report found no new actionable blocker; F1 and FU2 were closed. The exact [published review comment](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/485#issuecomment-6900116835) is also preserved locally under `provenance/`. The earlier Claude Opus 5.5 xhigh scan 1 returned **CHANGES REQUIRED** for F1. That historical verdict remains unchanged; scan 2 did not retroactively convert it to READY. The broader FU1 follow-up #486 and owner acceptance remain separate. This packet makes no overall AIDLC batch-completion or owner-acceptance claim.

The final current-head CI was run `43745479496`, attempt 2, successful against tested synthetic merge `955dccf755f5f34387f990ff47fa49c7bbf45f55`. Gates ran on the retry and passed 9,605 tests with 41 skipped across 13 coverage groups; every package met its line and branch floors. Browser, Windows launcher, and Template image outcomes were carried forward from their earlier successful jobs, not rerun in the Gates-only retry. The configured audit passed its high-severity threshold with 8 low and 13 moderate findings. The sibling CI packet records remaining qualifications, including the Browser live skip, strict performance mode being off, and the Windows upload step finding no native artifact.

## Report timestamps and inventory counts

The full Astra report records its final live GitHub readback at 19:31:10 UTC and its bound-input readback at 19:31:36 UTC. The final audit seal was at 19:35:33.912 UTC. Root separately verified the same head, target, tree, successful CI, and all 32 admitted inputs. The report was preserved without rewriting it to add the later seal.

The root disposition and published comment also clarify a separate count: the cancelled first-attempt CI packet has 31 evidence-manifest records and 32 checksum-inventory rows. The report’s phrase “32 first-attempt manifest entries” refers to the checksum inventory count. This clarification leaves the original report unchanged.

## Contents and verification

- [Full Astra report](audit-artifacts/full-report.md.txt), copied byte-for-byte from `review-485-astra-scan2/full-report.md` (SHA-256 `f4da5b8036bd21e3a9d98022927c4dda0361af6db587a65b79ce573434ce3a82`).
- [Original Astra audit inventory](audit-artifacts/SHA256SUMS.txt), retained byte-for-byte as source context. Its original filenames map to packet destinations in the top-level [source-copy map](source-copy-map.json).
- [Root Astra admission](provenance/runtime-485-astra-admission.json), [final disposition](provenance/runtime-485-astra-root-disposition.json), [merge readback](provenance/runtime-485-merge-root-readback.json), [CI acceptance](provenance/runtime-485-ci-693e-current-root-acceptance.json), and [CI publication acceptance](provenance/runtime-485-final-ci-publication-root-acceptance.json).
- [Exact published comment body](provenance/published-astra-comment-6900116835.md.txt) and the read-only API capture used to preserve it.
- [SHA-256 inventory](SHA256SUMS) covers every packet file except itself. It is separate from the unchanged original audit inventory.

The source report is renamed `.md.txt` so its original Markdown bytes remain intact. Its source-relative references may not resolve from this packet; use the links above and the sibling [review packet](../2026-11-15-runtime-failure-review/README.md).
