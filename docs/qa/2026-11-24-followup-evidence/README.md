# Evidence recorder QA: #534 and #539

This packet records independent review and QA before publication. The four changed source/test/documentation files are bound in [source-binding.json](source-binding.json) against base `d2df8600c2c8574bec420947de686b936910b245`. The frozen patch SHA-256 is `526d5eea2f8a8e8dd3d809365f9211cf04a774d746a1e84fcdf36b6f8dd6ce47`.

The recorder now closes cancelled tests as failures once, even if their bodies later return or throw. Scoped late cleanup observations remain available. The totals regression checks each inconsistent count against one valid-shaped totals row and unchanged contender receipts; it also preserves duplicate-row and failed-artifact controls.

[Independent GPT review 01](review-01/report.md.txt) passed with no actionable findings and independently reran all 43 maintained tests. [Fresh actual Claude Code Opus 5.5/xhigh QA](qa/report.md.txt) passed #534 and #539. Its three actual commands passed the maintained suite and both targeted checks. Coverage of the changed evidence module was 99.48% lines and 97.43% branches; this is not a claim about whole-package coverage. Tooling lint and scoped formatting passed during author verification.

| Control                                                                                      | Recorded observation                                                                                                                                        |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordinary pass and assertion throw                                                            | Correct pass/fail ends and parent attribution.                                                                                                              |
| Timed-out child, timed-out parent, unawaited child and child started after parent completion | Real `node:test` outcomes agree with the maintained evidence assertions; cancellation never becomes a later pass.                                           |
| Late cleanup                                                                                 | Observations remain associated with their original case/subtest after its terminal end.                                                                     |
| Failed native fixture                                                                        | Finalized `manifest.json`, `result.json` and `observations.ndjson` remain available with `native-failed`; no false passing artifact.                        |
| Contender totals                                                                             | A valid control completes; each balanced inconsistency produces exactly `contention-trials`, with failed-run evidence retained and receipt bytes unchanged. |

The sum constraint means changing exactly one count is structurally invalid. Those changes are explicitly rejected; the integration variants balance a second count so they reach the intended receipt comparison. They establish rejection for each inconsistent count, not logical independence of every redundant arithmetic predicate.

The [original red receipt](author/baseline-red.json) establishes parent-cancelled tests incorrectly recorded as passes. Its fixture differed from the final timeout controls; it is not a reproduction of the historical 240-second timeout incident. The native TAP control deliberately exits unsuccessfully, with 12 tests: 3 passed, 5 failed and 4 cancelled. That expected failure is retained in [CANCEL-NODE-TAP.log](qa/CANCEL-NODE-TAP.log), separately from the passing outer assertions.

The first independent QA wrapper misread Vitest's text-summary coverage format after the tests succeeded. Its [exit receipt](qa-first/exit.json) and [parser correction](qa-first/parser-correction.json) remain. The corrected fresh QA session reran the same three checks and issued the linked passing verdict. Author deadline/interruption history is described in [the final author report](author/report.md.txt) and the source binding; it is not counted as successful provider completion.

[MANIFEST.json](MANIFEST.json) lists the retained originals and hashes. Raw Markdown is retained as `.md.txt`; JSON and logs retain their original bytes. Wrapper scripts retain their original local paths and require isolated-path rebinding for replay. Private provider events and prompts are not published.

This QA exercised local Node test processes and public recorder/finalizer behavior. It did not run the real gateway, GUI or native Windows launcher suite, and it does not establish the historical #471 cause. Hosted CI, whole-package thresholds, the fresh independent final review, merge and owner acceptance remain separate pull-request gates.
