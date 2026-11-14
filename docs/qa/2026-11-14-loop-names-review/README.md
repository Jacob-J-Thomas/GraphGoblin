# PR #470 review and CI evidence

**Snapshot only.** Frozen candidate 0d2fad63c448bc5591c530d087dd05c9af7821cc, tree f095a8cd37122e36d65958482897e7fd55311853, against main 7c6e635539e12c56b82f226f1ee734d83b985ad4 ([frozen identity](raw/frozen-identity.json)). PR #470 was draft at admission. This bundle records two of three allowed independent scans and CI at the frozen head. Scan 3, a fresh whole-PR Astra max audit, remains reserved. The UI correction is active; no corrected candidate pass or review completion is claimed.

## Independent reviews

- **Backend, scan 1:** READY, no blocker. Claude Opus 5.5 (claude-opus-5-5) was confirmed by the original result with successful exit. xhigh was requested; effective reasoning effort is not independently observable. The reviewer had read-only tools and ran no commands. [Original report](raw/review-opus-backend-scan1.md.txt) · [GitHub review comment](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/470#issuecomment-6879450870)
- **UI, scan 2:** CHANGES REQUIRED. GPT-6.1 Sol xhigh identified U1 (selection ownership across overlapping imports) and U2 (a failed one-shot rename retry can remain armed). [Original report](raw/review-gpt-ui-scan2.md.txt) · [GitHub review comment](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/470#issuecomment-6879451133)
- The byte-preserved [original dispositions](raw/review-dispositions.md.txt) remain historical. Their U2 note says native invalid-companion evidence was still needed. A later independent native baseline run now confirms the defect on frozen head 0d2; that establishes the baseline failure, not a corrected pass. See the [planned U2 sibling report](../2026-11-14-loop-name-invalid-retry-baseline/README.md). Its queued older-save settlement case remains a proposed control.
- The one-paragraph guide change narrows the no-silent-name-substitution statement to owner loop creation, rename, import, and template copy. Its [report](raw/guide-correction-report.md.txt), [exact patch](raw/guide-correction.diff), [Prettier log](raw/guide-correction-prettier-check.log), [diff-check log](raw/guide-correction-diff-check.log), and [source hash](raw/guide-correction-source-hash.txt) are retained. Focused Prettier and diff checks passed. This is documentation only.

## Frozen-head CI

Run 43603766841 and routing run 43603766802 completed successfully at 0d2, before either review finding. Gates, Browser and Template passed on their first jobs. Gates passed all 22 coverage tasks: API 1,915 passed / 20 skipped; infrastructure 1,149 / 8 skipped; web 2,481 across 199 files; MCP 62. Browser passed 474 cases with one expected provider skip and no retries. Earlier API and infrastructure fixture failures were corrected as test-only changes before this run.

The first Windows launcher attempt had 13 passes and one failure: a refused contender emitted EPERM while unlinking the reclaim marker, so the final third-trial record assertion did not run. One unchanged job-only retry passed 14 tests with zero failures or skips. A passing retry does not resolve [follow-up #471](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/471), which retains the unproven unlink site and diagnostic requirements. The raw first failure and retry are both preserved. See [frozen gate status](raw/frozen-gate-status.md.txt), [Gates log](raw/ci43603766841-gates-pass.log), [Browser log](raw/ci43603766841-browser-pass.log), [Windows first failure](raw/ci43603766841-windows-first-failure.log), [Windows retry](raw/ci43603766841-windows-retry-pass.log), and the [first-attempt jobs](raw/ci43603766841-first-attempt-jobs.json) and [final jobs](raw/ci43603766841-final-jobs.json).

The CI result is not a post-correction run. Session 60913 owns U1/U2 UI and focused test corrections; independent corrected QA and current-head CI remain pending.

## Independent baseline reproductions

These two compact native bundles are separate planned QA siblings; they are linked, not duplicated here.

- **U1 import selection:** both delayed-A / selected-B races reproduced on the first run against 0d2 using Edge, the built Fastify API and disposable file SQLite. The retry sent A's exact graph under B's authored name; a late A success also removed B's visible retry form. Planned canonical report: [import-order baseline](../2026-11-14-loop-name-import-order-baseline/README.md). Fourteen files, 282,290 bytes; retain-manifest SHA-256 0d734cb96ad51689dbdb81ffbfd50107ff763bff8139277cd7575c2ad0e4aa4c.
- **U2 invalid companion:** reproduced on the first and only run at 0d2 with Edge, built gateway and disposable file SQLite. After the invalid description blocked the explicit retry, repairing only that field caused a PUT with no second retry; the original draft/token were preserved until that write. This independently confirms the baseline issue, not the fix. Planned canonical report: [invalid-retry baseline](../2026-11-14-loop-name-invalid-retry-baseline/README.md). Fourteen files, 382,554 bytes; retain-manifest SHA-256 4d5bf313a052314bc691bfb010f2005f60258686b2972fd23d26d2787151abd5.

## Remaining scope

Follow-ups [#472](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/472) and [#473](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/473) retain deleted-name reuse coverage and the separate MCP name-matching inconsistency. Preserve [#237](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/237) lifecycle work as separate scope. Do not treat these findings as additional #209 corrections unless the owner routes them back.

The final Astra max scan remains the third and last adversarial scan; no fourth scan is authorized. Corrected-build/native results, final review completion, merge, and owner acceptance are not claimed. Owner acceptance remains separate from CI and review. The root manifest.json records byte counts and SHA-256 values; SHA256SUMS.txt provides a flat verification list.
