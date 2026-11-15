# PR #484 completion evidence

**State: complete for the bounded #361 poll-deduplication work and its #483 Windows SQLite cleanup prerequisite.** PR #484 is merged, the current-head CI run passed, and the admitted formal reviews signed off. This records engineering completion; it does not claim owner acceptance for other delivery obligations or completion of the broader four-intent batch.

## Source, CI, review, and merge identity

- PR #484 reviewed head: `08651317c485062eb90367e1df3f7632f8e1a6c7`; tree: `c5d6d7f505e52b5ccf07b4bcb791777761dc45df`.
- Source candidate: commit `420240cad27d3865988dc7009dc9d80291e93c9c`, tree `75d6720f6cc7da85e04d9f17f8b96f40b94c4094`, with 12 source, test, and decision-document files.
- Review target: `main` at `15ce9a1dd12e87b7f7cb5f853aaecf68d6188afd`.
- CI run `43715831258`, attempt 1, tested synthetic merge `98d2bc2c473d3167a39ae966f9dfb9e2f00904fe` with the expected base and PR-head parents. All four triggered jobs passed. See the sibling [current-head CI packet](../2026-11-15-poll-dedupe-current-ci/README.md) for full logs and checkout identity.
- CI reported 9,588 passed and 41 skipped tests over 13 coverage groups; all 13 coverage floors passed. The 22-task combined coverage pipeline included 9 cached dependency-build tasks. Browser reported 481 passed and 1 skipped, with live-provider tests at zero and optional strict mode off. The Windows job reported 14/14 tests passed, but the upload step found no matching Windows artifact; no Windows artifact was produced. The audit reported 8 low and 13 moderate advisories.
- Claude Opus 5.5 at xhigh completed formal scan 1 of 3 with verdict **READY**, no numbered findings, and three non-blocking observations. The [full report](claude-scan1/full-report.md.txt) and separate [terminal summary](claude-scan1/provider-final-message.md.txt) are preserved. The [actual-model and exit readback](claude-scan1/actual-model-exit-readback.json) records the launched model and exit 0. Root published the [full scan 1 report](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/484#issuecomment-6895278204).
- GPT-6 Astra at max completed formal scan 2 of 3 with verdict **SIGN-OFF** and zero actionable findings. The byte-preserved [full report](astra-scan2/full-report.md.txt) has SHA-256 `9f09ca49428b360196b1232492c3a01b7a03c1642f91731ec859e1b86b2a1ff4`; the [seal](astra-scan2/seal.json) identifies the reviewer, effort, scan, verdict, and reviewed identity. The sealed Astra directory contains no distinct terminal-summary or process-exit file, so none is inferred. Root published the [full scan 2 report](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/484#issuecomment-6895791570).
- Merge readback confirms merge commit `f91bd69b79dc417a2997ddb9c7670cb33df7597c` at `2026-11-15T14:16:02Z`, tree `c5d6d7f505e52b5ccf07b4bcb791777761dc45df`, parents `15ce9a1dd12e87b7f7cb5f853aaecf68d6188afd` then `08651317c485062eb90367e1df3f7632f8e1a6c7`. It was verified as current `main`.

## Issues and scope status

The merge and fresh issue readback show issues [#361](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/361) and [#483](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/483) closed as completed. Issue #361's first completion-body update returned a connector transport error; a fresh read confirmed the body had not changed before one successful retry and exact readback. Issue #483's update and exact readback succeeded. The final gate receipt says neither issue required owner acceptance. Other owner acceptance remains separate and open.

The merge readback lists the remaining delivery order as #381 with #414, then #410, #419, #435, #436, #438, and #456. The four-intent register remains the authority for broader batch scope; see the [canonical register](../../delivery/2026-11-13-four-intents-register.md). The proposed append-only update for the root orchestrator is [delivery-register-append.md](delivery-register-append.md); it is external evidence text and has not been written into the repository.

## Native evidence and qualifications

The final disposition preserves the original native exit 1 and the prior failures. Root accepted the independent offline warning correlation, while retaining the original native result. The initial unrelated failures are not attributed to the #483 garbage-collection cleanup change. Its separate focused cleanup run passed 25 tests with zero failures and skips. Windows cleanup evidence is local: this CI run produced no Windows artifact. The evidence does not claim a cross-process race result. The #361/#483 engineering work is complete; these qualifications and separate owner obligations remain attached to that conclusion.

For the underlying chronology, see the sibling [old-behavior baseline packet](../2026-11-15-poll-dedupe-baseline/README.md), [implementation packet](../2026-11-15-poll-dedupe-implementation/README.md), and [corrected QA packet](../2026-11-15-poll-dedupe-corrected/README.md). The implementation packet's status language describes its earlier capture state; this completion packet and the accepted root readbacks supersede that snapshot.

## Retained evidence and integrity

- [Claude scan 1](claude-scan1/) includes the full report, distinct terminal summary, actual-model/exit readback, launch/exit receipts, and all 11 bounded probe files. The private `events.jsonl` stream and raw provider `result.json` envelope are excluded.
- [Astra scan 2](astra-scan2/) preserves all 21 sealed audit files, including the initial identity/CI corrections and verifier scripts. Its original `SHA256SUMS` covers the 20 listed files; the report is copied byte-for-byte as `.md.txt`, with the original manifest filename mapping recorded below.
- [Root readbacks](root-readbacks/) bind admissions, CI, final gates, merge, and exact issue completion state.
- [Preparation snapshot](preparation-snapshot/README.preparation.md.txt) and [preparation map](source-copy-map.preparation.json) preserve the earlier unsealed packet state. The [original preparation checksums](PREPARATION-SHA256SUMS.txt) are retained unchanged; the [derived snapshot inventory](PREPARATION-SHA256SUMS.snapshot.txt) remaps the prior README row to the preserved snapshot path and verifies all 23 entries.
- [Final source-copy map](source-copy-map.json) records source paths, destination paths, byte counts, and SHA-256 digests. [Final SHA-256 inventory](SHA256SUMS.txt) covers every packet file except itself.

The external packet contains no source checkout, Git index, database/store, build output, dependency tree, private provider event stream, or provider credentials. No repository, issue, PR, or GitHub state was changed for this curation.
