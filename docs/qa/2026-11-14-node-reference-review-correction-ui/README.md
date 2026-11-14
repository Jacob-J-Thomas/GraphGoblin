# PR #474 UI correction handoff

This packet preserves the UI correction for accepted findings U1, U2 and U3 from PR #474. The worker was Claude Opus 5.5 xhigh and exited 0 at 2026-11-14T19:21:33.998Z. The worktree stayed at `ae8add8a791699e905540465b5ddf929d00c50eb` (tree `ea2dfcfd46f7d5ab79fd98414db214513d830b52`); no commit was made. The original [handoff](raw/source/handoff.md.txt) and [worker report](raw/source/report.md.txt) are preserved byte-for-byte.

## Corrections

- **U1:** A successful rename carries the collection row identities from the old config to the repaired config only when every recorded collection has the same length. Row content is not used for matching. The node editor performs the carry before the remount, preserving the open row and nested focus on Enter and pointer commit.
- **U2:** The rename report retains the definition as it stood after the rename. A review row is actionable only while that node still has the same config object; otherwise it remains informational and the notice says the places show where they were at rename time. This is conservative: any config edit to that node withdraws its links until undo restores the rename-time object.
- **U3:** A valid held section-JSON candidate remains `PENDING_JSON` even when it becomes structurally equal to the current section. Only author actions—typing to equality, Apply, Cancel or discard—release the hold. No confirmation flow or silent text rewrite was added.
- **Documentation:** `docs/09`, the guide and the CHANGELOG separate automatic form writeback from explicit raw JSON Apply, show JSONata and Liquid syntax separately, explain the direct single-presence caveat, and clarify which notice rows open a field.

The [source diff](raw/diffs/source.diff), [test diff](raw/diffs/tests.diff), [docs diff](raw/diffs/docs.diff), [combined diff](raw/diffs/combined-ui-correction.diff), and [old-source regression-test diff](raw/diffs/old-code-tests.diff) preserve the exact patch artifacts and their hashes. The worker changed five product files, four test files and three documentation files. No source snapshot is duplicated.

## Evidence from the worker

Five new regressions failed on the old code. The first old-source run reported 5 failed and 49 passed in the two focused files; the pointer rerun moved the focus assertion first to identify the focus fallback. After the fixes, those two files passed 54/54. The 20-file focused neighbourhood passed 406/406, the two new unit files passed 5/5, and the final six-file set passed 70/70. The old-source failures and each later run are preserved under [raw/logs](raw/logs/).

Web no-emit typecheck, web lint, and Prettier on all 12 touched files passed. The 1,227 compiled `dist` files and 11 `.tsbuildinfo` entries are byte-identical before and after; both sorted per-file manifests are preserved. This is an artifact readback only: no build or TypeScript emission ran. Coverage percentage was not measured.

The worker reports that backend-domain files changed concurrently in the shared checkout. Web tests and typechecking resolve `@graphgoblin/domain` through its development source and therefore saw the in-progress domain code as it existed at each run. This packet covers the UI correction only and does not claim a combined freeze or verification.

## Pending gates and limits

No build, full web suite or coverage, Playwright/browser, API, native verification or owner acceptance is claimed here. Root still owns the combined corrected-source freeze, exact-head CI, build and coverage, independent native scenarios, browser gates, and fresh Astra max scan 3. The source correction is not a review verdict.

The worker left the Loop Settings form's disclosure state unchanged and did not verify its collection rows. Identity carry also requires the form's old config to match the store's pre-rename object; otherwise rows receive new ids as before. U2 withdraws links for any edited config on that node until undo. U3 applies to all held section JSON, so a buffer that becomes equal through a sibling fix or remount remains held and blocks Publish or editor switching until resolved.

For the original findings, see the [initial review packet](../2026-11-14-node-reference-initial-reviews/README.md). The separate [domain correction packet](../2026-11-14-node-reference-review-correction-domain/README.md) contains focused evidence for F1/F2; it is not combined CI or native proof. See [manifest.json](manifest.json) for source-to-copy hashes, [link-checks.json](link-checks.json) for local and sibling links, and [SHA256SUMS.txt](SHA256SUMS.txt) for packet integrity. Worker event streams and full result/session files are excluded.
