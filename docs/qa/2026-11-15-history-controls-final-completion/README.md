# History controls final completion

This packet records the final review, QA, CI, merge, and issue readbacks for the stationarity slice of #208, delivered as PR #480.

## Final identity and disposition

- Reviewed PR head: **5a31678f5a8611ae3a89a1f6aefe797d7106a08e**, tree **c247968a388b1c74e7727ec27d4fe465ebfde0d0**.
- Actual merge: **177f3a7d57768c88f19c6bb4d8ef2b272c1e91bd**, same tree, with parents **1cfca9bce3967c9d41950266c83aab636667e0ab** and **5a31678f5a8611ae3a89a1f6aefe797d7106a08e**. The exact [merge readback](actual-merge-readback.json) records the merged PR state and Git identity.
- The independent final audit signed off at formal scan **2 of 3**, with no introduced blocker and no new deferred issue. The [full Astra report](report.md.txt) references the first Sol review; its complete report is preserved in the separate initial-review packet and referenced by the [first-review comment](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/480#issuecomment-6887160473). The exact [verification ledger](verification.json) preserves all 28 verified artifact rows.
- The pre-merge [final-gates publication readback](final-gates-publication-readback.json) is timestamped before the merge and shows the PR open at that readback. The later merge record above establishes the actual merge. The post-merge [#208 status readback](issue208-merge-status-readback.json) records comment 6890460532 and the issue still open with owner acceptance pending.

This packet records completion of the history-controls engineering slice. #208 remains open. At this snapshot its combined criterion remains unchecked while the separate Space cards child is pending. Owner acceptance is separately required before issue closure.

## Evidence summary

- **Native QA:** 11 of 11 groups passed on initial attempts, with 77 qualified stationary target windows, 21 trusted held presses, 66 exact conditional saves, and four deliberate native 404 responses. The audit report and verification artifacts preserve the detailed limits: Windows Edge automation, injected coarse touch, and a DPR-2 reflow proxy do not establish physical touch, actual browser text zoom, screen-reader speech, or other engines.
- **Focused checks:** 60 existing tests and three added external lifecycle checks passed on their first attempts. Checker scripts, first/corrected/final checker logs, focused command/results, lifecycle test, cleanup, and before/after evidence are retained.
- **CI:** All five jobs passed on attempt 1. Browser passed 481 with one declared live-provider skip and zero retries; Windows launcher passed 14/14; template image passed; coverage reported 9,394 passed and 41 skipped across 13 packages, each above 90% line and branch coverage. Normal routing limits passed. The measured frame p95 was about 33.3 ms; optional strict manual-dispatch thresholds were inactive and are not part of the normal pull-request gate. The high-severity audit threshold passed with 8 low and 13 moderate advisories.
- **Retarget qualification:** CI was triggered before the PR retarget. Job logs show merge **b08bf0ea5f304bd1bfb83b58dd2588607fb943a8**, parented by former base **48dddb1af1239bbdddc7d7c9c8b0e47c0431c6c6** and the PR head. Its complete tree equals the later current-main merge tree and the approved head tree. The final audit independently checked the workflow context and accepted that tree-equivalence evidence; the run is not described as an event targeting current main. See the retained [root retarget-equivalence record](root-ci-retarget-equivalence.md.txt).
- **Issue status:** The exact [post-merge issue readback](issue208-merge-status-readback.json) says #208 remains open, its combined criterion unchecked, and owner acceptance required before closure.

The final report’s source and QA binding is retained as the [source-and-evidence readback](source-and-evidence-readback.json), including 1,447 source path/hash/Git-blob rows. The [non-QA diff](non-qa.diff) is retained with its original hash. Two initial checker failures are preserved with the final passing checker result; they are evidence-check assertions, not failures from the product test suites.

## Packet contents and omissions

The full report, brief, root clarifications, exact verification ledger, all 28 artifacts named by that ledger, checker scripts and attempts, focused test records, identity/dispatch records, and merge/gates/issue readbacks are retained. Original Markdown reports are copied as .md.txt to preserve their exact bytes.

The 106,220,395-byte exact full diff is not copied; its SHA-256 is **363ae80ac5b57c21a898c2f63fa2e5c2ad5536f27c3785d7ab0ba2c5752bfb63**. One 201-byte Vite cache file is omitted. Both exclusions, with source paths and hashes, are recorded in the [curation manifest](curation-manifest.json). The complete 429,470-byte source-and-evidence readback is retained instead of projecting its 1,447 path/hash rows.

Curation changed no source checkout, Git index, CI run, or GitHub state. The [SHA256SUMS](SHA256SUMS) file covers every packet file other than itself, and [link checks](link-checks.json) records local README link validation.
