# QA packet publication checker evidence for #524

`pnpm check:qa --base <ref>` checks the QA paths a branch would publish. It formats nothing, reports SHA-256 for retained opaque originals and refuses new Markdown named as an immutable original. Selected paths missing from a sparse checkout fail with a diagnostic. Older archives keep their original names and bytes.

The [final source binding](source-binding.json) identifies the six reviewed paths against base `d2df8600c2c8574bec420947de686b936910b245` and patch SHA-256 `8e637cfc58897ae39b1d7b5feff303a058420e479d7f0309fc05c454f6713423`.

| Review                                              | Observed failure                                                                                                                       | Correction                                                                                              |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [Formal review 1](review-01/REVIEW.md.txt)          | An unstaged Git diff refreshed the index despite disabling optional locks. One focused test failed.                                    | Disable automatic index refresh per Git invocation.                                                     |
| [Targeted formal review 2](review-02/REVIEW.md.txt) | The first fix kept index bytes intact, but selected a historical Markdown file whose CRLF rewrite normalized to the same indexed blob. | Ask Git for each unstaged-only modified path's patch using literal pathspecs, and filter empty patches. |

Both negative reviews and their disposable controls remain in the packet, including the original index snapshots and the [transcribed first-run failure](review-01/FIRST-FAILURE.log), labelled as such by the reviewer. The [first correction](author/correction-01/IMPLEMENTATION-REPORT.claude.md.txt) and [second correction](author/correction-02/IMPLEMENTATION-REPORT.claude.md.txt) are retained separately. The reserved fresh final review is the third formal pass.

[Fresh independent Claude Code Opus 5.5 (xhigh) QA](qa/QA-REPORT.claude.md.txt) passed 11 focused tests with 100% line, branch, statement and function coverage on the checker module. The disposable CRLF control selected the real edit and raw retained original, excluded changes normalized away by Git, and kept both index and source bytes unchanged. It covered a literal bracketed filename and its look-alike. A separate run against the frozen delivery worktree selected zero QA paths before this packet was added. The nonempty stderr receipts contained pnpm command echoes.

The selected-module coverage leaves full-package coverage to the hosted gate. The checker starts a Git process for each unstaged-only modified path and caps a buffered Git response at 256 MiB. High-volume performance was outside these controls. The pre-publication check applies only to changed QA paths, and the full format and CI gates still apply.

[MANIFEST.json](MANIFEST.json) records each original source receipt and its SHA-256. Original Markdown uses `.md.txt` and packet-local Git attributes preserve the raw bytes. Review scripts may refer to their tool-run paths and disposable fixtures. Private provider prompts and events are excluded.
