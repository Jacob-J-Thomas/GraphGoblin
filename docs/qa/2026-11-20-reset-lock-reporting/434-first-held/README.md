# #434 first-candidate independent QA — held

**Held for a separate acquisition/cleanup failure.** This packet records candidate **a8191dd97aacfe9709d2369afd60497214bf00a7**, tree 3d885cfd72a5854a887e4efb9954db4aa2619e1b, against signed baseline **8181f350028e284529c76b51927f32890afcb68a**. The [publication hold](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/531#issuecomment-7033700508) remains required: a later controlled acquisition failure left ownership metadata while reporting “Nothing in the data directory was changed.” Its original-source and integration-preview outcomes are separate from the operator runs below. [Exact posted hold](records/publication-hold.original.txt).

The independent Opus terminal genuinely completed with exit 0 at 08:13:10.409 UTC. Its three-criterion acceptance verdict applies to its executed cases; it does not clear the separate hold or establish corrected-candidate QA. [Terminal/source provenance](provenance.json).

| Preserved execution                                                           | Original result                                                           |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [Signed baseline, unchanged 13-case driver](records/baseline.projection.json) | 218/282 pass, 64 fail; acceptance 15/69, safety 66/66.                    |
| [Candidate original first run](records/run-01.projection.json)                | **280/282 pass, 2 fail**; acceptance 69/69, safety 66/66.                 |
| [Candidate original second run](records/run-02.projection.json)               | **280/282 pass, 2 fail**; every original assertion outcome matches run 1. |
| [Supplement v1](records/targeted-v1.projection.json)                          | 224/231 pass, 7 fail; all 52 acceptance-kind checks pass.                 |
| [Supplement v2](records/targeted-v2.projection.json)                          | 49/50 pass, 1 fail; all 11 acceptance-kind checks pass.                   |
| [Supplement v3](records/targeted-v3.projection.json)                          | 26/28 pass, 2 fail; zero acceptance-kind checks in this version.          |

The baseline-to-first-run transition is 63 fail→pass, 217 pass→pass, one pass→fail (S08) and one fail→fail (S11). These are executed assertions, not unique acceptance criteria. No original failed flag or count is rewritten.

## Exact S08 and S11 dispositions

**S08: positive/AC2 driver false negative, retained in both runs.** The old regex only accepts “Released graphgoblin.lock” or the old same-line release wording. Actual output says “removed graphgoblin.lock (data-directory lock),” and both lock files are absent in the captured after tree. T01R regrades retained output without re-execution (2/2); T01 separately reruns the case with wording-neutral checks (10/10). Neither changes the original 280/282 records.

**S11: observation/AC3, unchanged from baseline.** The nested db/readme.txt is byte-preserved but omitted from the top-level Keeps listing. Before/after evidence and all original assertion objects remain present. It is not reported as an extra fixed failure.

## Supplemental negatives and coverage limits

The supplemental versions remain distinct. T07a v1 fails during fixture setup because the hard link was created before stale locks; the corrected v2 fixture passes 14/14. T09 still records a safety failure in both v1 and v2: PowerShell's cache appears under the disposable redirected profile, outside the data directory. It never reaches the owner's profile.

T04a/T04c and T04f preserve raw EISDIR refusals that do not name the requested lock path. The data remains unchanged; the named database-lock refusal occurs only in T04e's no-database fixture. The baseline was not executed for these supplemental controls: calling this pre-existing rests on source inspection. T02's exact-case observation fails while case-folded removal disclosure passes. The hard-linked-database preview/confirmed refusal gap and T08's initially promised release followed by a truthful kept-replacement-record line remain qualifications. Their original negative outcomes are in the projections.

Actual coverage includes dry/confirmed manifests, lock/guard ownership classifications, removal and release failures, unrelated-byte preservation, held owners, replacement-record preservation and default-home isolation. Lock ownership is supplied by the product's built lock code in helpers, not a running API server. S09 and T08 use timing races whose preconditions were observed won. Windows/NTFS only; no repository/new-unit suites, lock-path junction/symlink, container, Linux/macOS or owner installation was tested here.

## Integrity and reproduction

Run `node verify-evidence.mjs --integrity-only` for hashes, 1155 original assertions, per-kind counts, unchanged repeat outcomes, S08/S11 support and local links. Default replay returns held/exit 2. It runs no product, driver, Git or network action.

All assertions, expected/actual values, outcomes, totals, CLI output, manifests and filesystem diffs are faithfully projected. Only checkout/QA scratch prefixes become role aliases. Raw argv/environment values and setup metadata are omitted; complete trees are retained for S08/S11. [Projection recipe](project-results.mjs) reproduces each projection from its original hash-bound input and original QA-root argument. Original report, comparison and console artifact hashes are retained in provenance; private path-bearing originals remain outside this packet.

The [13-case driver](drivers/qa-434-reset-locks.mjs), its helpers and current supplemental driver retain exact executed bytes. Prior v1/v2 scripts are stored once as lossless gzip archives and verified after decompression. For a native rerun, copy drivers to a new writable QA scratch folder and supply the built checkout, label and expected head; the drivers create disposable fixtures there. Keep this sealed packet unchanged. [Evidence manifest](evidence-manifest.json) inventories every file except itself. This is first-candidate evidence, with no publication release, corrected-source acceptance, CI or merge sign-off.
